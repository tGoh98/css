/**
 * Backfill competitor sources.
 *
 *   tsx scripts/backfill/competitors.ts [--limit N]
 *
 * Per ARCHITECTURE.md "Backfill strategy: same shape as primary news
 * (recent-only for news; full for blogs)".
 *
 * - News competitors (Adobe, Canva): Google News RSS, recent items only.
 *   Google News doesn't expose deep history through the free path.
 * - Blog competitors (Sketch, Penpot): RSS feeds, which give the recent
 *   N items. We don't attempt deep scrape archives here — Sketch and
 *   Penpot are low-volume sources and the live ingest will catch up.
 */

import Parser from "rss-parser";
import {
  classifyAndStore,
  ensureSource,
  insertBackfilledItem,
  parseFlags,
  sleep,
} from "./_common";

type FeedDef = {
  name: string;
  kind: "competitor-news" | "competitor-blog";
  url: string;
};

const FEEDS: FeedDef[] = [
  {
    name: "Google News (Adobe)",
    kind: "competitor-news",
    url: "https://news.google.com/rss/search?q=Adobe+Figma+OR+%22Adobe+XD%22&hl=en-US&gl=US&ceid=US:en",
  },
  {
    name: "Adobe newsroom",
    kind: "competitor-news",
    url: "https://news.adobe.com/rss/index.xml",
  },
  {
    name: "Google News (Canva)",
    kind: "competitor-news",
    url: "https://news.google.com/rss/search?q=Canva&hl=en-US&gl=US&ceid=US:en",
  },
  {
    name: "Canva blog",
    kind: "competitor-blog",
    url: "https://www.canva.com/learn/feed/",
  },
  {
    name: "Sketch blog",
    kind: "competitor-blog",
    url: "https://www.sketch.com/blog/feed.xml",
  },
  // Penpot blog is intentionally absent: penpot.app publishes no RSS/Atom feed
  // (every candidate URL 404s — verified 2026-08-06). The source row exists but
  // is disabled; Penpot product news comes from "Penpot GitHub releases".
  // See scripts/fix-competitor-feeds.ts.
];

async function backfillFeed(def: FeedDef, parser: Parser, limit: number): Promise<{ scanned: number; kept: number }> {
  const sourceId = await ensureSource({
    name: def.name,
    kind: def.kind,
    category: "competitor",
    configJson: { url: def.url },
  });

  let scanned = 0;
  let kept = 0;
  try {
    const feed = await parser.parseURL(def.url);
    for (const entry of feed.items) {
      if (kept >= limit) break;
      scanned++;
      const link = entry.link ?? entry.guid;
      if (!link) continue;
      const title = entry.title?.trim() ?? "(untitled)";
      const snippet = (entry.contentSnippet ?? entry.content ?? entry.summary ?? null)?.toString().slice(0, 4000) ?? null;
      const publishedAt = entry.isoDate
        ? new Date(entry.isoDate)
        : entry.pubDate
        ? new Date(entry.pubDate)
        : new Date();
      const externalId = entry.guid ?? link;
      const itemId = await insertBackfilledItem({
        sourceId,
        externalId: `${def.kind}:${externalId}`,
        url: link,
        title,
        snippet,
        author: entry.creator ?? entry.author ?? null,
        publishedAt,
        rawJson: { feed: def.url, guid: entry.guid, categories: entry.categories },
      });
      if (itemId) {
        await classifyAndStore({
          itemId,
          title,
          snippet,
          url: link,
          sourceName: def.name,
          sourceKind: def.kind,
        });
        kept++;
      }
    }
  } catch (err) {
    console.warn(`[backfill:competitors] ${def.name} feed error:`, err);
  }
  return { scanned, kept };
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const limit = flags.limit ?? Number.POSITIVE_INFINITY;
  const parser = new Parser({ timeout: 20_000 });

  let totalScanned = 0;
  let totalKept = 0;
  for (const def of FEEDS) {
    if (totalKept >= limit) break;
    const remaining = limit - totalKept;
    const { scanned, kept } = await backfillFeed(def, parser, remaining);
    totalScanned += scanned;
    totalKept += kept;
    console.log(`[backfill:competitors] ${def.name} scanned=${scanned} kept=${kept}`);
    await sleep(400);
  }
  console.log(`[backfill:competitors] done scanned=${totalScanned} inserted=${totalKept}`);
}

main().catch((err) => {
  console.error("[backfill:competitors] failed:", err);
  process.exit(1);
});
