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
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, itemClassifications, sources } from "@/db/schema";
import { classifyItem } from "@/ai/classifier";
import { emptyResult, type IngestResult } from "./_shared";

/** Bounded so a large backlog can't blow the 60s Vercel function budget. */
export const DEFAULT_MAX_PER_RUN = 40;

/**
 * Ignore items fetched within this window — they are probably still being
 * classified, not orphaned.
 *
 * `insertAndClassify` INSERTs the item row and only then awaits `classifyItem`
 * (a 300 ms coalescing debounce plus a Haiku round-trip, and a second one if
 * the batch has to fall back to per-item retries). For that whole window the
 * row exists with no classification — measured at avg 2.4 s / max 6.8 s over
 * the 7 days to 2026-08-11.
 *
 * The backlog count below is global, so *any* concurrent writer trips it: the
 * sibling pollers in `tick-slow`'s own `Promise.allSettled`, and equally a
 * `tick-fast` run overlapping this one. Without a grace window their healthy
 * in-flight rows read as a backlog.
 *
 * That caused a false "N item(s) still unclassified" saturation email on
 * 2026-08-10 (swept 1, reported 3 remaining — the 3 were healthy items mid
 * classify; the true backlog was 0, and every item fetched that day is now
 * classified). Ordinary volume is ~2 items per 10-minute window, so 3 in
 * flight is unremarkable. The window also keeps the sweeper from
 * double-classifying an item a concurrent poller already owns, which billed
 * two Haiku calls for one item.
 *
 * Ten minutes is far longer than any legitimate classify takes, and costs
 * nothing: a genuinely orphaned item is simply swept on the next tick.
 */
export const ORPHAN_GRACE_MS = 10 * 60 * 1000;

export async function reclassifyOrphans(
  maxPerRun: number = DEFAULT_MAX_PER_RUN,
): Promise<IngestResult> {
  const result = emptyResult();

  // One cutoff instant shared by both queries below, so the "remaining" count
  // describes exactly the population this run was allowed to sweep. Recomputing
  // it per query would let items age into the window in between and reappear as
  // a phantom backlog.
  const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);

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
    .where(and(isNull(itemClassifications.itemId), lt(items.fetchedAt, cutoff)))
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
  // classifier fault would silently look like steady-state. Same `cutoff` as
  // the SELECT above: this counts items that had ample time to be classified
  // and still weren't, never ones a concurrent poller is mid-flight on.
  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(items)
    .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
    .where(and(isNull(itemClassifications.itemId), lt(items.fetchedAt, cutoff)));

  if (remaining > 0) {
    result.warnings.push(
      `${remaining} item(s) still unclassified after sweeping ${orphans.length} (cap ${maxPerRun}/run)`,
    );
  }

  return result;
}
