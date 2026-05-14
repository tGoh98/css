/**
 * Reddit search poller across the configured subreddits.
 *
 * Uses the unauthenticated `search.json` endpoint with `restrict_sr=on`.
 * Reddit aggressively blocks generic UAs and python-requests defaults, so
 * we always send a descriptive UA.
 */
import {
  ensureSource,
  fetchWith,
  insertAndClassify,
  markPolled,
  emptyResult,
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

// Per-sub cap + classifier concurrency so the route fits under Vercel's 60s
// function cap. Mirrors news.ts and competitors.ts.
const MAX_ITEMS_PER_SUB = 10;
const CLASSIFY_CONCURRENCY = 5;

interface RedditListing {
  data: {
    children: Array<{
      data: {
        id: string;
        name: string;
        title: string;
        selftext?: string;
        author?: string;
        permalink: string;
        url: string;
        created_utc: number;
        subreddit: string;
        score?: number;
        num_comments?: number;
      };
    }>;
  };
}

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();

  const sourceId = await ensureSource({
    name: "Reddit search (Figma)",
    kind: "reddit",
    category: "core",
    configJson: { subreddits: SUBREDDITS, query: "Figma" },
  });

  for (const sub of SUBREDDITS) {
    const url = `https://www.reddit.com/r/${sub}/search.json?q=Figma&sort=new&restrict_sr=on&limit=25`;
    let listing: RedditListing;
    try {
      const res = await fetchWith(url, {}, "CSS-Aggregator/1.0 (by /u/tgoh98; contact timgoh98@gmail.com)");
      listing = (await res.json()) as RedditListing;
    } catch (err) {
      result.errors.push(
        `reddit r/${sub}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const children = (listing.data?.children ?? []).slice(0, MAX_ITEMS_PER_SUB);
    for (let i = 0; i < children.length; i += CLASSIFY_CONCURRENCY) {
      const batch = children.slice(i, i + CLASSIFY_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (c) => {
          const d = c.data;
          const permalink = `https://www.reddit.com${d.permalink}`;
          await insertAndClassify(
            sourceId,
            "Reddit search (Figma)",
            "reddit",
            {
              externalId: d.name, // e.g. "t3_abc123" — globally unique on Reddit
              url: permalink,
              title: d.title,
              snippet: (d.selftext ?? "").slice(0, 1500) || null,
              author: d.author ?? null,
              publishedAt: new Date(d.created_utc * 1000),
              rawJson: {
                subreddit: d.subreddit,
                score: d.score ?? null,
                num_comments: d.num_comments ?? null,
                external_url: d.url,
              },
            },
            result,
          );
        }),
      );
    }
  }

  await markPolled(sourceId);
  return result;
}
