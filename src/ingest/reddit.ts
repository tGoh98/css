/**
 * Reddit search poller across the configured subreddits.
 *
 * Switched from `/search.json` to `/search.rss` after the JSON endpoint
 * began returning 403 from Vercel's data-center IPs. RSS sometimes
 * survives where JSON does not. If RSS also gets blocked we'll need
 * to either move this ingest local (matching the digest worker
 * pattern) or move to authenticated Reddit OAuth.
 */
import Parser from "rss-parser";
import {
  ensureSource,
  insertAndClassify,
  markPolled,
  emptyResult,
  countsForSaturation,
  type IngestResult,
} from "./_shared";

// r/Figma is the action-figure subreddit (Levi/Erwin etc.). The actual
// Figma design-tool community is r/FigmaDesign. Plus broader design and
// financial subs that occasionally discuss Figma as a company.
const SUBREDDITS = [
  // Direct + adjacent design communities
  "FigmaDesign",
  "design",
  "UI_Design",
  "userexperience",
  "web_design",
  // Financial / investing chatter relevant to FIG the stock
  "stocks",
  "StockMarket",
  "wallstreetbets",
  "investing",
  "ValueInvesting",
  "SecurityAnalysis",
  "IPO",
];

// Per-sub cap + classifier concurrency + per-sub parallelism so the route
// fits under Vercel's 60s function cap. Mirrors news.ts and competitors.ts.
//
// 2026-05-14: bumped to parallel-subs after a 504 timeout — running 12 subs
// sequentially × ~4s each was sitting at ~50–55s wall-clock and tipped past
// 60s under classifier-latency jitter. SUB_CONCURRENCY=4 gives ~3 batches ×
// ~4s ≈ 12–16s with comfortable margin.
const MAX_ITEMS_PER_SUB = 10;
const CLASSIFY_CONCURRENCY = 5;
const SUB_CONCURRENCY = 4;

interface RedditRssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
  creator?: string;
  author?: string;
}

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();

  const sourceId = await ensureSource({
    name: "Reddit search (Figma)",
    kind: "reddit",
    category: "core",
    configJson: { subreddits: SUBREDDITS, query: "Figma", endpoint: "rss" },
  });

  const parser: Parser<unknown, RedditRssItem> = new Parser({
    headers: {
      "User-Agent":
        "CSS-Aggregator/1.0 (by /u/tgoh98; contact timgoh98@gmail.com)",
    },
    timeout: 20_000,
  });

  const pollSub = async (sub: string): Promise<void> => {
    const url = `https://www.reddit.com/r/${sub}/search.rss?q=Figma&restrict_sr=on&sort=new&limit=25`;
    let feed;
    try {
      feed = await parser.parseURL(url);
    } catch (err) {
      result.errors.push(
        `reddit r/${sub}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const items = (feed.items as RedditRssItem[]).slice(0, MAX_ITEMS_PER_SUB);
    let newCount = 0;
    for (let i = 0; i < items.length; i += CLASSIFY_CONCURRENCY) {
      const batch = items.slice(i, i + CLASSIFY_CONCURRENCY);
      const outcomes = await Promise.allSettled(
        batch.map(async (entry) => {
          if (!entry.title || !entry.link) return "dedup" as const;
          const externalId = entry.guid ?? entry.link;
          const publishedAt = entry.isoDate
            ? new Date(entry.isoDate)
            : entry.pubDate
              ? new Date(entry.pubDate)
              : new Date();
          return await insertAndClassify(
            sourceId,
            "Reddit search (Figma)",
            "reddit",
            {
              externalId,
              url: entry.link,
              title: entry.title,
              snippet: entry.contentSnippet ?? null,
              author: entry.creator ?? entry.author ?? null,
              publishedAt,
              rawJson: {
                subreddit: sub,
                raw: entry as unknown as Record<string, unknown>,
              },
            },
            result,
          );
        }),
      );
      for (const r of outcomes) {
        if (r.status === "fulfilled" && countsForSaturation(r.value)) newCount += 1;
      }
    }
    if (newCount >= MAX_ITEMS_PER_SUB) {
      result.warnings.push(
        `reddit r/${sub}: SATURATED — all ${newCount}/${MAX_ITEMS_PER_SUB} items new; older posts may be lost`,
      );
    }
  };

  for (let i = 0; i < SUBREDDITS.length; i += SUB_CONCURRENCY) {
    const batch = SUBREDDITS.slice(i, i + SUB_CONCURRENCY);
    await Promise.allSettled(batch.map((sub) => pollSub(sub)));
  }

  await markPolled(sourceId);
  return result;
}
