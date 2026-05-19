/**
 * Topic clustering over the last 24h of un-clustered items.
 *
 * Approach: pull (item_id, title, one_line) for items where cluster_id IS
 * NULL and published_at within last 24h. Feed them to Haiku as a JSON list,
 * ask it (via tool_use) to return groups of related items + a representative
 * title for each group. Persist clusters and write item.cluster_id back.
 *
 * Single-item groups are still recorded — every recent item ends up with a
 * cluster_id so the Feed's "collapse duplicates" UI doesn't have to special
 * case unclustered items.
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, inArray, isNull, not, sql } from "drizzle-orm";
import { z } from "zod";
import { logAiUsage } from "@/ai/usage";
import { db } from "@/db";
import { itemClassifications, itemClusters, items, sources } from "@/db/schema";

export const CLUSTER_MODEL = "claude-haiku-4-5";

/**
 * Source kinds that come from /admin/upload. These are explicitly exempted
 * from cluster grouping: when the user uploads a PDF they expect it to show
 * as its own row in /feed regardless of whether a scraped news item covers
 * the same event. Cluster grouping was hiding uploads behind the more recent
 * news representative.
 *
 * All manual uploads now route to kind="upload" after the 2026-05-14
 * source consolidation.
 */
const UPLOAD_SOURCE_KINDS = ["upload"];

const CLUSTER_SYSTEM = `You are the topic-clustering engine for a Figma-focused news aggregator.

You will receive a JSON array of recent items, each with { id, title, one_line }. Group items that cover the SAME underlying event or story (e.g. multiple outlets reporting the same earnings beat, the same product launch, the same lawsuit). Items about distinct events go in their own group, even if same broad topic.

Be conservative: only group items if a reasonable reader would say "these are reporting the same news". If unsure, leave the item in its own single-item group.

For each group, pick a short neutral representative_title (max 100 chars) that captures the underlying story. Use one of the input titles or write a concise summary.

You MUST place every input id in exactly one group. Return ONLY by calling the \`cluster\` tool.`;

const ClusterOutput = z.object({
  clusters: z
    .array(
      z.object({
        representative_title: z.string().min(1).max(200),
        item_ids: z.array(z.number().int()).min(1),
      }),
    )
    .min(0),
});

export type ClusterOutput = z.infer<typeof ClusterOutput>;

export interface ClusterRunResult {
  itemsConsidered: number;
  clustersCreated: number;
  itemsAssigned: number;
  errors: string[];
}

const CLUSTER_TOOL = {
  name: "cluster",
  description: "Emit the cluster assignment for the given items.",
  input_schema: {
    type: "object" as const,
    properties: {
      clusters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            representative_title: { type: "string" },
            item_ids: {
              type: "array",
              items: { type: "integer" },
              minItems: 1,
            },
          },
          required: ["representative_title", "item_ids"],
          additionalProperties: false,
        },
      },
    },
    required: ["clusters"],
    additionalProperties: false,
  },
};

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return cachedClient;
}

/**
 * Re-cluster recent (last 24h) un-clustered items. Idempotent: only items
 * with cluster_id IS NULL are touched, so repeated runs are cheap.
 */
export async function clusterRecent(): Promise<ClusterRunResult> {
  const result: ClusterRunResult = {
    itemsConsidered: 0,
    clustersCreated: 0,
    itemsAssigned: 0,
    errors: [],
  };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      publishedAt: items.publishedAt,
      oneLine: itemClassifications.oneLine,
    })
    .from(items)
    .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        isNull(items.clusterId),
        gte(items.publishedAt, since),
        // Exempt manual uploads from clustering — they should always show
        // as their own row in /feed, never hidden behind a scraped item.
        not(inArray(sources.kind, UPLOAD_SOURCE_KINDS)),
      ),
    )
    .limit(200);

  result.itemsConsidered = rows.length;
  if (rows.length === 0) return result;

  // For very small windows just give each item its own cluster — no LLM call.
  if (rows.length === 1) {
    const row = rows[0];
    await createCluster(row.title, [row.id], row.publishedAt);
    result.clustersCreated += 1;
    result.itemsAssigned += 1;
    return result;
  }

  const userPayload = JSON.stringify(
    rows.map((r) => ({ id: r.id, title: r.title, one_line: r.oneLine ?? "" })),
  );

  let parsed: ClusterOutput;
  try {
    const resp = await client().messages.create({
      model: CLUSTER_MODEL,
      max_tokens: 4096,
      // No cache_control: clustering is one call per daily run with nothing to
      // reuse within a TTL, and CLUSTER_SYSTEM (~220 tokens) is far below
      // Haiku's 2048-token cache floor anyway, so it would be a silent no-op.
      system: [{ type: "text", text: CLUSTER_SYSTEM }],
      tools: [CLUSTER_TOOL],
      tool_choice: { type: "tool", name: "cluster" },
      messages: [{ role: "user", content: `Items:\n${userPayload}` }],
    });

    void logAiUsage({
      job: "cluster",
      model: CLUSTER_MODEL,
      usage: resp.usage,
      itemCount: rows.length,
    });

    const toolBlock = resp.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      result.errors.push("no tool_use block in cluster response");
      return result;
    }
    parsed = ClusterOutput.parse(toolBlock.input);
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  // Validate: every input id must be covered exactly once. If the model
  // missed some, fall back to single-item clusters for the leftovers.
  const inputIds = new Set(rows.map((r) => r.id));
  const seen = new Set<number>();
  for (const c of parsed.clusters) {
    for (const id of c.item_ids) {
      if (inputIds.has(id)) seen.add(id);
    }
  }
  const leftovers = [...inputIds].filter((id) => !seen.has(id));
  for (const id of leftovers) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    parsed.clusters.push({ representative_title: row.title, item_ids: [id] });
  }

  const rowById = new Map(rows.map((r) => [r.id, r]));
  for (const cluster of parsed.clusters) {
    const validIds = cluster.item_ids.filter((id) => inputIds.has(id));
    if (validIds.length === 0) continue;
    const ts = validIds
      .map((id) => rowById.get(id)?.publishedAt)
      .filter((d): d is Date => d instanceof Date);
    const firstSeen = ts.length > 0 ? new Date(Math.min(...ts.map((d) => d.getTime()))) : new Date();
    const lastSeen = ts.length > 0 ? new Date(Math.max(...ts.map((d) => d.getTime()))) : new Date();
    try {
      await createCluster(cluster.representative_title, validIds, lastSeen, firstSeen);
      result.clustersCreated += 1;
      result.itemsAssigned += validIds.length;
    } catch (err) {
      result.errors.push(
        `cluster ${cluster.representative_title}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

async function createCluster(
  representativeTitle: string,
  itemIds: number[],
  lastSeenAt: Date,
  firstSeenAt: Date = lastSeenAt,
): Promise<void> {
  const truncated =
    representativeTitle.length > 200 ? representativeTitle.slice(0, 200) : representativeTitle;
  const [{ id }] = await db
    .insert(itemClusters)
    .values({
      representativeTitle: truncated,
      itemCount: itemIds.length,
      firstSeenAt,
      lastSeenAt,
    })
    .returning({ id: itemClusters.id });

  await db
    .update(items)
    .set({ clusterId: id })
    .where(and(inArray(items.id, itemIds), isNull(items.clusterId)));

  // Recompute item_count in case some items were already assigned and got filtered out.
  await db
    .update(itemClusters)
    .set({
      itemCount: sql`(select count(*)::int from ${items} where ${items.clusterId} = ${id})`,
    })
    .where(eq(itemClusters.id, id));
}
