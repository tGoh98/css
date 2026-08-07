/**
 * Orphan re-classifier.
 *
 * `insertAndClassify` inserts the item row first, then classifies it. When the
 * classifier call errors, the row is kept deliberately (see the comment in
 * `_shared.ts`) — but nothing ever came back for it: the next poll can't
 * re-insert (external_id collides) and can't re-classify (the row already
 * exists). Orphans therefore accumulate forever, invisible to the Feed (which
 * inner-joins classifications) and to the digest worker (same join).
 *
 * On 2026-08-06 the backlog was 22 items, all from two runs (07-17 and 07-21)
 * where a batch classify call failed. This sweeper closes that loop.
 *
 * Idempotent and cheap: classification is batched Haiku (~$0.0001/item), and
 * in steady state there is nothing to do.
 */
import { eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, itemClassifications, sources } from "@/db/schema";
import { classifyItem } from "@/ai/classifier";
import { emptyResult, type IngestResult } from "./_shared";

/** Bounded so a large backlog can't blow the 60s Vercel function budget. */
export const DEFAULT_MAX_PER_RUN = 40;

export async function reclassifyOrphans(
  maxPerRun: number = DEFAULT_MAX_PER_RUN,
): Promise<IngestResult> {
  const result = emptyResult();

  const orphans = await db
    .select({
      id: items.id,
      title: items.title,
      snippet: items.snippet,
      url: items.url,
      sourceName: sources.name,
      sourceKind: sources.kind,
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
    .where(isNull(itemClassifications.itemId))
    .orderBy(sql`${items.fetchedAt} asc`)
    .limit(maxPerRun);

  if (orphans.length === 0) return result;

  // classifyItem coalesces concurrent calls into one batched Haiku request, so
  // firing them together is both faster and cheaper than a sequential loop.
  const outcomes = await Promise.allSettled(
    orphans.map((o) =>
      classifyItem({
        itemId: o.id,
        title: o.title,
        snippet: o.snippet,
        url: o.url,
        sourceName: o.sourceName,
        sourceKind: o.sourceKind,
      }),
    ),
  );

  for (let i = 0; i < outcomes.length; i++) {
    const r = outcomes[i];
    if (r.status === "rejected") {
      result.errors.push(`reclassify item ${orphans[i].id}: ${String(r.reason)}`);
      continue;
    }
    if (r.value.kind === "classified") result.inserted += 1;
    else if (r.value.kind === "dropped") result.skipped += 1;
    else result.errors.push(`reclassify item ${orphans[i].id}: ${r.value.error}`);
  }

  // Surface a backlog we couldn't drain in one pass — otherwise a persistent
  // classifier fault would silently look like steady-state.
  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(items)
    .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
    .where(isNull(itemClassifications.itemId));

  if (remaining > 0) {
    result.warnings.push(
      `${remaining} item(s) still unclassified after sweeping ${orphans.length} (cap ${maxPerRun}/run)`,
    );
  }

  return result;
}
