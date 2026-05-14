/**
 * Backfill Hacker News mentions of Figma via Algolia search.
 *
 *   tsx scripts/backfill/hn.ts [--limit N] [--since 2018-01-01]
 *
 * Uses the date-cursor pattern: query with `numericFilters=created_at_i<{ts}`,
 * descending, then advance the cursor to the oldest result's timestamp. Walks
 * back to ~2018 by default.
 */

import { classifyAndStore, ensureSource, insertBackfilledItem, parseFlags, sleep } from "./_common";

type AlgoliaHit = {
  objectID: string;
  title?: string;
  story_title?: string;
  story_text?: string | null;
  url?: string;
  author: string;
  created_at: string;
  created_at_i: number;
  points?: number;
  num_comments?: number;
};

type AlgoliaResponse = {
  hits: AlgoliaHit[];
  nbHits: number;
  page: number;
  nbPages: number;
};

async function fetchPage(maxTsExclusive: number): Promise<AlgoliaResponse> {
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=Figma&tags=story&numericFilters=created_at_i<${maxTsExclusive}&hitsPerPage=100`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Algolia ${res.status}`);
  return (await res.json()) as AlgoliaResponse;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const limit = flags.limit ?? Number.POSITIVE_INFINITY;
  // Default floor: Jan 1 2018
  const floor = flags.since ?? new Date("2018-01-01T00:00:00Z");
  const floorTs = Math.floor(floor.getTime() / 1000);

  const sourceId = await ensureSource({
    name: "Hacker News (Figma)",
    kind: "hn",
    category: "core",
  });

  let cursor = Math.floor(Date.now() / 1000) + 60;
  let scanned = 0;
  let kept = 0;

  while (kept < limit) {
    const page = await fetchPage(cursor);
    if (page.hits.length === 0) break;
    let oldestTs = cursor;
    for (const hit of page.hits) {
      if (kept >= limit) break;
      scanned++;
      if (hit.created_at_i < oldestTs) oldestTs = hit.created_at_i;
      const title = hit.title ?? hit.story_title ?? "(untitled)";
      const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const itemId = await insertBackfilledItem({
        sourceId,
        externalId: `hn:${hit.objectID}`,
        url,
        title,
        snippet: hit.story_text ?? null,
        author: hit.author,
        publishedAt: new Date(hit.created_at),
        rawJson: hit as unknown as Record<string, unknown>,
      });
      if (itemId) {
        await classifyAndStore({
          itemId,
          title,
          snippet: hit.story_text ?? null,
          url,
          sourceName: "Hacker News (Figma)",
          sourceKind: "hn",
        });
        kept++;
      }
    }
    if (oldestTs <= floorTs) {
      console.log(`[backfill:hn] hit floor ${floor.toISOString()}`);
      break;
    }
    if (oldestTs >= cursor) {
      console.warn("[backfill:hn] cursor did not advance; stopping to avoid loop");
      break;
    }
    cursor = oldestTs; // strictly-less filter excludes the boundary itself
    console.log(`[backfill:hn] scanned=${scanned} kept=${kept}, next cursor=${new Date(cursor * 1000).toISOString()}`);
    await sleep(250);
  }

  console.log(`[backfill:hn] done scanned=${scanned} inserted=${kept}`);
}

main().catch((err) => {
  console.error("[backfill:hn] failed:", err);
  process.exit(1);
});
