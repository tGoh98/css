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

// Verified 2026-05-14: Sketch publishes an Atom feed at feed.xml, not /feed/.
const SKETCH_BLOG_RSS = "https://www.sketch.com/blog/feed.xml";
// Verified 2026-05-14: penpot.app/blog/feed/ 301s → /blog/rss/.
const PENPOT_BLOG_RSS = "https://penpot.app/blog/rss/";
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

// Per-brand caps so adding more brands stays under Vercel's 60s function cap.
// The classifier relevance filter will discard most off-topic items anyway.
const MAX_ITEMS_PER_BRAND = 15;
const PER_BRAND_CONCURRENCY = 4;

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
    const entries = (feed.items as RssItem[]).slice(0, MAX_ITEMS_PER_BRAND);
    for (let i = 0; i < entries.length; i += PER_BRAND_CONCURRENCY) {
      const batch = entries.slice(i, i + PER_BRAND_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (entry) => {
          if (!entry.title || !entry.link) return;
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
        }),
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

  // Brand-level parallelization on top of the per-brand cap+parallel.
  // 10 brands × ~5s serial = 50s; running 3 in flight at a time keeps the
  // whole route ~20s — well under Vercel's 60s function cap.
  const BRAND_CONCURRENCY = 3;
  const brandTasks: Array<() => Promise<void>> = [
    // Established players.
    () => pollGoogleNews("Adobe", "Adobe design tool", result),
    () => pollGoogleNews("Canva", "Canva design", result),
    () => pollRssBlog("Sketch", SKETCH_BLOG_RSS, result),
    () => pollRssBlog("Penpot", PENPOT_BLOG_RSS, result),
    () => pollPenpotReleases(result),
    // AI-native challengers — newer entrants pressing on Figma's AI strategy.
    // Queries are quoted to reduce noise; classifier relevance filter handles
    // whatever still slips through.
    () => pollGoogleNews("Google Stitch", '"Google Stitch" design', result),
    () => pollGoogleNews("Claude design", '"Claude" Anthropic design tool', result),
    () => pollGoogleNews("Pencil", '"Pencil" AI design', result),
    () => pollGoogleNews("Dessn", '"Dessn" design', result),
    () => pollGoogleNews("Galileo AI", '"Galileo AI" design', result),
    () => pollGoogleNews("Uizard", "Uizard", result),
  ];

  for (let i = 0; i < brandTasks.length; i += BRAND_CONCURRENCY) {
    const batch = brandTasks.slice(i, i + BRAND_CONCURRENCY);
    await Promise.allSettled(batch.map((t) => t()));
  }

  return result;
}
