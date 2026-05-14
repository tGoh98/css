/**
 * Analyst-signal poller for the FIG ticker.
 *
 * Yahoo Finance dropped: their unofficial endpoint started returning 401
 * (requires a session "crumb" cookie that's a pain to maintain server-side).
 * Seeking Alpha covers the analyst signal we actually care about.
 *
 * Seeking Alpha publishes per-ticker XML at the `/combined/<T>.xml` path.
 * Verified 2026-05-13: returns 200 with content-type application/xml.
 */
import Parser from "rss-parser";
import {
  ensureSource,
  insertAndClassify,
  markPolled,
  emptyResult,
  USER_AGENT,
  type IngestResult,
} from "./_shared";

const SA_URL = "https://seekingalpha.com/api/sa/combined/FIG.xml";

async function pollSeekingAlpha(result: IngestResult): Promise<void> {
  const sourceName = "Seeking Alpha (FIG)";
  const sourceId = await ensureSource({
    name: sourceName,
    kind: "news",
    category: "core",
    configJson: { ticker: "FIG", feedUrl: SA_URL },
  });

  interface SAItem {
    title?: string;
    link?: string;
    pubDate?: string;
    isoDate?: string;
    contentSnippet?: string;
    creator?: string;
    guid?: string;
  }

  const parser: Parser<unknown, SAItem> = new Parser({
    headers: { "User-Agent": USER_AGENT },
    timeout: 20_000,
  });

  try {
    const feed = await parser.parseURL(SA_URL);
    for (const entry of feed.items as SAItem[]) {
      if (!entry.title || !entry.link) continue;
      const publishedAt = entry.isoDate
        ? new Date(entry.isoDate)
        : entry.pubDate
          ? new Date(entry.pubDate)
          : new Date();
      await insertAndClassify(
        sourceId,
        sourceName,
        "news",
        {
          externalId: entry.guid ?? entry.link,
          url: entry.link,
          title: entry.title,
          snippet: entry.contentSnippet ?? null,
          author: entry.creator ?? null,
          publishedAt,
          rawJson: { ticker: "FIG", source: "seeking-alpha", raw: entry as unknown as Record<string, unknown> },
        },
        result,
      );
    }
    await markPolled(sourceId);
  } catch (err) {
    result.errors.push(
      `seeking-alpha: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();
  await pollSeekingAlpha(result);
  return result;
}
