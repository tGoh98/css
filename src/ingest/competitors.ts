/**
 * Competitor poller — single function that fans out across Adobe, Canva,
 * Sketch, and Penpot. Each brand has different signal sources:
 *
 *   Adobe  — Google News scoped query (high volume; the AI relevance filter
 *            culls the noise).
 *   Canva  — Google News scoped query.
 *   Sketch — blog RSS (URL unconfirmed, see TODO below) → graceful no-op.
 *   Penpot — blog RSS feed (URL unconfirmed, see TODO below) plus GitHub
 *            releases API (works without auth, low limit).
 *
 * Each section is wrapped in its own try/catch so one broken upstream doesn't
 * take down the whole cron call.
 */
import Parser from "rss-parser";
import {
  ensureSource,
  fetchWith,
  insertAndClassify,
  markPolled,
  emptyResult,
  USER_AGENT,
  type IngestResult,
} from "./_shared";

const GOOGLE_NEWS = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

// TODO: verify URL — Sketch may not actually publish RSS at this path.
const SKETCH_BLOG_RSS = "https://www.sketch.com/blog/feed/";
// TODO: verify URL — Penpot blog feed not confirmed; this was the documented guess.
const PENPOT_BLOG_RSS = "https://penpot.app/blog/feed.xml";
const PENPOT_GH_RELEASES = "https://api.github.com/repos/penpot/penpot/releases";

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  guid?: string;
  creator?: string;
}

async function pollGoogleNews(
  brand: string,
  query: string,
  result: IngestResult,
): Promise<void> {
  const sourceName = `Google News (${brand})`;
  const sourceId = await ensureSource({
    name: sourceName,
    kind: "competitor-news",
    category: "competitor",
    configJson: { brand, query },
  });
  const parser: Parser<unknown, RssItem> = new Parser({
    headers: { "User-Agent": USER_AGENT },
    timeout: 20_000,
  });
  try {
    const feed = await parser.parseURL(GOOGLE_NEWS(query));
    for (const entry of feed.items as RssItem[]) {
      if (!entry.title || !entry.link) continue;
      const publishedAt = entry.isoDate
        ? new Date(entry.isoDate)
        : entry.pubDate
          ? new Date(entry.pubDate)
          : new Date();
      await insertAndClassify(
        sourceId,
        sourceName,
        "competitor-news",
        {
          externalId: entry.guid ?? entry.link,
          url: entry.link,
          title: entry.title,
          snippet: entry.contentSnippet ?? null,
          publishedAt,
          rawJson: { brand, query, raw: entry as unknown as Record<string, unknown> },
        },
        result,
      );
    }
    await markPolled(sourceId);
  } catch (err) {
    result.errors.push(
      `${sourceName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function pollRssBlog(
  brand: string,
  feedUrl: string,
  result: IngestResult,
): Promise<void> {
  const sourceName = `${brand} blog`;
  const sourceId = await ensureSource({
    name: sourceName,
    kind: "competitor-blog",
    category: "competitor",
    configJson: { brand, feedUrl, note: "URL unverified — may 404" },
  });
  const parser: Parser<unknown, RssItem> = new Parser({
    headers: { "User-Agent": USER_AGENT },
    timeout: 20_000,
  });
  try {
    const feed = await parser.parseURL(feedUrl);
    for (const entry of feed.items as RssItem[]) {
      if (!entry.title || !entry.link) continue;
      const publishedAt = entry.isoDate
        ? new Date(entry.isoDate)
        : entry.pubDate
          ? new Date(entry.pubDate)
          : new Date();
      await insertAndClassify(
        sourceId,
        sourceName,
        "competitor-blog",
        {
          externalId: entry.guid ?? entry.link,
          url: entry.link,
          title: entry.title,
          snippet: entry.contentSnippet ?? null,
          author: entry.creator ?? null,
          publishedAt,
          rawJson: { brand, raw: entry as unknown as Record<string, unknown> },
        },
        result,
      );
    }
    await markPolled(sourceId);
  } catch (err) {
    // URLs are unconfirmed — record but do not fail.
    result.errors.push(
      `${sourceName} (TODO: verify URL ${feedUrl}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface GitHubRelease {
  id: number;
  html_url: string;
  name: string | null;
  tag_name: string;
  body: string | null;
  published_at: string | null;
  author?: { login?: string };
}

async function pollPenpotReleases(result: IngestResult): Promise<void> {
  const sourceName = "Penpot GitHub releases";
  const sourceId = await ensureSource({
    name: sourceName,
    kind: "competitor-blog",
    category: "competitor",
    configJson: { brand: "Penpot", repo: "penpot/penpot", kind: "github-releases" },
  });

  try {
    const res = await fetchWith(PENPOT_GH_RELEASES, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    const releases = (await res.json()) as GitHubRelease[];
    for (const r of releases) {
      const publishedAt = r.published_at ? new Date(r.published_at) : new Date();
      await insertAndClassify(
        sourceId,
        sourceName,
        "competitor-blog",
        {
          externalId: String(r.id),
          url: r.html_url,
          title: `Penpot ${r.tag_name}${r.name && r.name !== r.tag_name ? `: ${r.name}` : ""}`,
          snippet: r.body ? r.body.slice(0, 1500) : null,
          author: r.author?.login ?? null,
          publishedAt,
          rawJson: { brand: "Penpot", tag: r.tag_name, release_id: r.id },
        },
        result,
      );
    }
    await markPolled(sourceId);
  } catch (err) {
    result.errors.push(
      `Penpot GitHub releases: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();

  await pollGoogleNews("Adobe", "Adobe design tool", result);
  await pollGoogleNews("Canva", "Canva", result);
  await pollRssBlog("Sketch", SKETCH_BLOG_RSS, result);
  await pollRssBlog("Penpot", PENPOT_BLOG_RSS, result);
  await pollPenpotReleases(result);

  return result;
}
