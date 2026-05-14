/**
 * Google News RSS poller — "Figma" query.
 *
 * Google News doesn't require auth, but it does rate-limit; we keep one
 * request per cron tick and rely on the unique index on
 * (source_id, external_id) to make repeat polls cheap.
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

const FEED_URL =
  "https://news.google.com/rss/search?q=Figma&hl=en-US&gl=US&ceid=US:en";

interface GoogleNewsItem {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
  creator?: string;
  source?: string | { _: string; "$": { url: string } };
}

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();
  const parser: Parser<unknown, GoogleNewsItem> = new Parser({
    headers: { "User-Agent": "CSS Aggregator timgoh98@gmail.com" },
    timeout: 20_000,
  });

  const sourceId = await ensureSource({
    name: "Google News (Figma)",
    kind: "news",
    category: "core",
    configJson: { query: "Figma", feedUrl: FEED_URL },
  });

  let feed;
  try {
    feed = await parser.parseURL(FEED_URL);
  } catch (err) {
    result.errors.push(
      `google-news fetch: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  // Google News returns ~100 items; serial classification (≈1s each via
  // Anthropic) blows past Vercel Hobby's 60s function cap on the first run.
  // Cap per-cycle work and parallelize the classifier calls. Items beyond
  // MAX_ITEMS are the older ones and will be ingested in subsequent ticks
  // as the feed shifts. At CONCURRENCY=6 and ~1s/classify, 60 items takes
  // ~10s — comfortable under the 60s function cap.
  const MAX_ITEMS = 60;
  const CONCURRENCY = 6;
  const entries = (feed.items as GoogleNewsItem[]).slice(0, MAX_ITEMS);

  let newCount = 0;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.allSettled(
      batch.map(async (entry) => {
        if (!entry.link || !entry.title) {
          result.errors.push("google-news: missing title/link");
          return "error" as const;
        }
        const externalId = entry.guid ?? entry.link;
        const publishedAt = entry.isoDate
          ? new Date(entry.isoDate)
          : entry.pubDate
            ? new Date(entry.pubDate)
            : new Date();
        const sourceLabel =
          typeof entry.source === "string"
            ? entry.source
            : (entry.source?._ ?? null);
        const snippet = entry.contentSnippet ?? entry.content ?? null;

        return await insertAndClassify(
          sourceId,
          "Google News (Figma)",
          "news",
          {
            externalId,
            url: entry.link,
            title: entry.title,
            snippet,
            author: sourceLabel,
            publishedAt,
            rawJson: entry as unknown as Record<string, unknown>,
          },
          result,
        );
      }),
    );
    for (const r of outcomes) {
      if (r.status === "fulfilled" && countsForSaturation(r.value)) newCount += 1;
    }
  }

  // Saturation: every slot in our top-MAX_ITEMS window was a new item. Items
  // past position MAX_ITEMS in the feed are at risk of being pushed out before
  // we poll again. Surfaced via the route handler.
  if (newCount >= MAX_ITEMS) {
    result.warnings.push(
      `google-news: SATURATED — all ${newCount}/${MAX_ITEMS} items this tick were new; older items may be lost`,
    );
  }

  await markPolled(sourceId);
  return result;
}
