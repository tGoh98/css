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

  for (const entry of feed.items as GoogleNewsItem[]) {
    if (!entry.link || !entry.title) {
      result.errors.push("google-news: missing title/link");
      continue;
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

    await insertAndClassify(
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
  }

  await markPolled(sourceId);
  return result;
}
