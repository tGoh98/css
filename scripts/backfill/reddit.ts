/**
 * Backfill Reddit mentions of Figma across the configured subs.
 *
 *   tsx scripts/backfill/reddit.ts [--limit N]
 *
 * Uses the public `/search.json` endpoint with a `before` cursor (the
 * `name` field of the oldest post on a page). Pushshift is dead so we
 * accept ~few months of depth — Reddit's own search returns up to ~1000
 * results per (sub, query) combination.
 *
 * NOTE: Reddit aggressively rate-limits anonymous requests. We back off
 * heavily and stop early on 429s.
 */

import { classifyAndStore, ensureSource, insertBackfilledItem, parseFlags, sleep } from "./_common";

// r/Figma is the action-figure subreddit, not the design tool. The actual
// Figma community is r/FigmaDesign. See src/ingest/reddit.ts for the rationale.
const SUBS = [
  "FigmaDesign",
  "design",
  "UI_Design",
  "userexperience",
  "web_design",
  "stocks",
  "StockMarket",
  "wallstreetbets",
  "investing",
  "ValueInvesting",
  "SecurityAnalysis",
  "IPO",
];
const QUERY = "Figma";
const UA = "Mozilla/5.0 (compatible; CSS-Backfill/0.1; by /u/css-tool)";

type RedditChild = {
  kind: string;
  data: {
    id: string;
    name: string; // t3_xxxxx — used as the `before` cursor
    title: string;
    selftext: string | null;
    author: string;
    permalink: string;
    url: string;
    created_utc: number;
    subreddit: string;
  };
};

type RedditListing = {
  data: {
    after: string | null;
    children: RedditChild[];
  };
};

async function searchSub(sub: string, after: string | null): Promise<RedditListing | null> {
  const params = new URLSearchParams({
    q: QUERY,
    restrict_sr: "1",
    sort: "new",
    t: "all",
    limit: "100",
  });
  if (after) params.set("after", after);
  const url = `https://www.reddit.com/r/${sub}/search.json?${params.toString()}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (res.status === 429) {
    console.warn(`[backfill:reddit] 429 on r/${sub}, backing off 30s`);
    await sleep(30_000);
    return null;
  }
  if (!res.ok) {
    console.warn(`[backfill:reddit] r/${sub} returned ${res.status}`);
    return null;
  }
  return (await res.json()) as RedditListing;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const limit = flags.limit ?? Number.POSITIVE_INFINITY;

  const sourceId = await ensureSource({
    name: "Reddit (Figma search)",
    kind: "reddit",
    category: "core",
    configJson: { subs: SUBS, query: QUERY },
  });

  let scanned = 0;
  let kept = 0;

  for (const sub of SUBS) {
    let after: string | null = null;
    let pagesInSub = 0;
    while (kept < limit && pagesInSub < 20) {
      const listing = await searchSub(sub, after);
      if (!listing) break;
      const children = listing.data.children;
      if (children.length === 0) break;
      for (const child of children) {
        if (kept >= limit) break;
        scanned++;
        const d = child.data;
        const title = d.title;
        const snippet = d.selftext ? d.selftext.slice(0, 4000) : null;
        const itemId = await insertBackfilledItem({
          sourceId,
          externalId: `reddit:${d.name}`,
          url: `https://www.reddit.com${d.permalink}`,
          title,
          snippet,
          author: d.author,
          publishedAt: new Date(d.created_utc * 1000),
          rawJson: { subreddit: d.subreddit, id: d.id, name: d.name, url: d.url },
        });
        if (itemId) {
          await classifyAndStore({
            itemId,
            title,
            snippet,
            url: `https://www.reddit.com${d.permalink}`,
            sourceName: `Reddit r/${d.subreddit}`,
            sourceKind: "reddit",
          });
          kept++;
        }
      }
      if (!listing.data.after) break;
      after = listing.data.after;
      pagesInSub++;
      await sleep(2_000); // polite — Reddit's anon QPS is ~1/sec
    }
    console.log(`[backfill:reddit] r/${sub} done (pages=${pagesInSub})`);
  }

  console.log(`[backfill:reddit] done scanned=${scanned} inserted=${kept}`);
}

main().catch((err) => {
  console.error("[backfill:reddit] failed:", err);
  process.exit(1);
});
