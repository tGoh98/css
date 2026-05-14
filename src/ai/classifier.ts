/**
 * Ingest-time AI classifier.
 *
 * Single Haiku 4.5 call per new item that produces:
 *   { relevance: 0-1, priority: 'routine'|'notable'|'breaking', one_line }
 *
 * Strategy:
 * - Use tool_use for structured output (forced via tool_choice).
 * - Cache the static system prompt across calls with `cache_control` so we
 *   only pay full input cost once per ~5 min window.
 * - Validate the model's tool input with zod.
 * - If relevance < 0.4 we DELETE the item row entirely (consistent rule:
 *   the item simply does not exist for the rest of the pipeline). Caller
 *   gets back a discriminated result so it can update its counters.
 * - When the result is `breaking`, fire-and-forget a notification via a
 *   dynamic import to `@/notify` (owned by Phase 2C). Errors swallowed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { itemClassifications, items } from "@/db/schema";

export const CLASSIFIER_MODEL = "claude-haiku-4-5";

const ClassifierOutput = z.object({
  relevance: z.number().min(0).max(1),
  priority: z.enum(["routine", "notable", "breaking"]),
  one_line: z.string().min(1).max(500),
});

export type ClassifierOutput = z.infer<typeof ClassifierOutput>;

export type ClassifyResult =
  | { kind: "classified"; itemId: number; output: ClassifierOutput }
  | { kind: "dropped"; itemId: number; reason: "low-relevance"; relevance: number }
  | { kind: "error"; itemId: number; error: string };

const SYSTEM_PROMPT = `You are the ingest-time classifier for a personal news aggregator focused on Figma, Inc. — the design-software company (creator of the Figma design tool, FigJam, recently public on the NYSE as ticker FIG).

Your job is to look at a single piece of content (a news headline + snippet, an SEC filing label, a Reddit/HN post, a blog post, etc.) and decide three things:

1. relevance (0-1): How relevant is this to someone tracking the *business and product of Figma, Inc.*?
   - 1.0 = directly about Figma (the company), its products, executives, financials, or a competitor's move that affects Figma.
   - 0.5 = adjacent (the design-tools industry, AI-in-design trends, named competitor news with no direct Figma angle).
   - 0.0 = unrelated (the word "figma" appears but in a different context: a person's name, a math/CS term, an unrelated foreign-language match, a meme, a recruiting post).
   Be strict. Anything below 0.5 will be discarded.

2. priority: How urgent is this for the user to see? **Default to 'routine'.** Higher tiers are RARE — escalate only when the item meets the criteria below verbatim. When in doubt, drop one tier (breaking → notable, notable → routine).

   - 'breaking' (~1-3% of items): a material event a public-market investor would act on within hours. ONLY use for ALL of these — not just any one of them in spirit:
     * M&A announcement, deal close, or termination
     * Earnings release **with surprise** vs consensus (beat/miss/guidance change)
     * Sudden executive change (CEO/CFO/founder departure or replacement)
     * Brand-new top-level product launch (not a feature, not a beta, not an update)
     * Lawsuit filed or settled with disclosed material exposure
     * Regulatory action with operational impact
     * Single insider transaction exceeding ~$1M in disclosed value
     * Major outage or security incident
     Note: a fresh SEC filing **is not breaking on its own** — only its *contents* can be. A standard 8-K, 10-K, 10-Q, or S-1/A is 'notable' unless its body describes one of the events above.

   - 'notable' (~10-20% of items): meaningful business or product signal that doesn't demand immediate attention.
     * Quarterly/annual SEC filings (10-K, 10-Q, S-1) without a surprise inside
     * 8-Ks that disclose ordinary course changes (governance, comp, routine amendments)
     * Significant feature launches and roadmap announcements
     * Named partnerships or integrations with public companies
     * **Changes** in analyst ratings or price targets (not standing ratings)
     * Industry-structural moves involving Adobe / Canva / Sketch / AI-design challengers when they plausibly affect Figma

   - 'routine' (the default, expect the majority): everything else.
     * Community chatter, Reddit / HN discussions, opinion pieces, tutorials
     * Hiring announcements, conference talks, blog posts, recaps
     * Routine Form 4 filings (officer/director transactions below the ~$1M bar)
     * Standing analyst ratings with no change
     * Tangential mentions, listicles, "best design tools" pieces

3. one_line: A single neutral sentence (max ~25 words) summarizing what happened. No editorializing, no hedging ("appears to", "reportedly"). Past tense.

Output ONLY by calling the \`classify\` tool. Do not write any prose response.`;

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return cachedClient;
}

const CLASSIFY_TOOL = {
  name: "classify",
  description: "Emit the structured classification of the item.",
  input_schema: {
    type: "object" as const,
    properties: {
      relevance: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "How relevant is this item to tracking Figma, Inc. (the design-software company). 0 = unrelated, 1 = directly about Figma.",
      },
      priority: {
        type: "string",
        enum: ["routine", "notable", "breaking"],
        description: "Urgency tier; see system prompt for definitions.",
      },
      one_line: {
        type: "string",
        description: "One neutral past-tense sentence summarizing the item.",
      },
    },
    required: ["relevance", "priority", "one_line"],
    additionalProperties: false,
  },
};

interface ClassifyInput {
  itemId: number;
  title: string;
  snippet?: string | null;
  url: string;
  sourceName: string;
  sourceKind: string;
}

function buildUserMessage(i: ClassifyInput): string {
  const lines = [
    `Source: ${i.sourceName} (${i.sourceKind})`,
    `URL: ${i.url}`,
    `Title: ${i.title}`,
  ];
  if (i.snippet) {
    // Cap snippet length to keep cost predictable.
    const cut = i.snippet.length > 1500 ? i.snippet.slice(0, 1500) + "…" : i.snippet;
    lines.push(`Snippet: ${cut}`);
  }
  return lines.join("\n");
}

/**
 * Classify a single item, persist the result (or drop the item), and
 * optionally fire a breaking-news notification. Idempotent: if a
 * classification row already exists for the item we no-op.
 */
export async function classifyItem(input: ClassifyInput): Promise<ClassifyResult> {
  // Skip if already classified (re-runs after partial failure).
  const existing = await db
    .select({ itemId: itemClassifications.itemId })
    .from(itemClassifications)
    .where(eq(itemClassifications.itemId, input.itemId))
    .limit(1);
  if (existing.length > 0) {
    return {
      kind: "error",
      itemId: input.itemId,
      error: "already-classified",
    };
  }

  let parsed: ClassifierOutput;
  try {
    const resp = await client().messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 256,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "classify" },
      messages: [{ role: "user", content: buildUserMessage(input) }],
    });

    const toolBlock = resp.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      return { kind: "error", itemId: input.itemId, error: "no tool_use block in response" };
    }
    parsed = ClassifierOutput.parse(toolBlock.input);
  } catch (err) {
    return {
      kind: "error",
      itemId: input.itemId,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Drop low-relevance items entirely. cascade removes any side rows.
  // Threshold raised from 0.4 → 0.5 (2026-05-13) to reduce feed noise.
  if (parsed.relevance < 0.5) {
    await db.delete(items).where(eq(items.id, input.itemId));
    return {
      kind: "dropped",
      itemId: input.itemId,
      reason: "low-relevance",
      relevance: parsed.relevance,
    };
  }

  await db.insert(itemClassifications).values({
    itemId: input.itemId,
    relevance: parsed.relevance.toFixed(3),
    priority: parsed.priority,
    oneLine: parsed.one_line,
    classifierModel: CLASSIFIER_MODEL,
  });

  if (parsed.priority === "breaking") {
    // Phase 2C owns @/notify. Use dynamic import so missing module doesn't
    // break the build/runtime of this module.
    await import("@/notify")
      .then((m) => (m as { notifyBreaking?: (id: number) => Promise<void> }).notifyBreaking?.(input.itemId))
      .catch(() => {});
  }

  return { kind: "classified", itemId: input.itemId, output: parsed };
}
