/**
 * Competitor poller — data-driven version.
 *
 * Sources live in the `sources` table where `category='competitor'`. Each row
 * carries a `config_json` blob that tells this ingester how to poll it:
 *
 *   { method: "google-news", brand: "Adobe",  query: "Adobe design tool" }
 *   { method: "rss",         brand: "Sketch", feedUrl: "https://www.sketch.com/blog/feed.xml" }
 *   { method: "github-releases", brand: "Penpot", repo: "penpot/penpot" }
 *
 * Adding a new competitor = INSERT a row (or use the /admin/competitors UI).
 * No code deploy.
 */
import Parser from "rss-parser";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import {
  fetchWith,
  insertAndClassify,
  markPolled,
  emptyResult,
  USER_AGENT,
  type IngestResult,
} from "./_shared";

const GOOGLE_NEWS = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

// Per-brand caps + classifier concurrency so the route stays under Vercel's
// 60s function cap regardless of how many competitors are configured.
const MAX_ITEMS_PER_BRAND = 15;
const PER_BRAND_CONCURRENCY = 4;
const BRAND_CONCURRENCY = 3;

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  guid?: string;
  creator?: string;
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

async function pollGoogleNews(
  sourceId: number,
  sourceName: string,
  brand: string,
  query: string,
  result: IngestResult,
): Promise<void> {
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
  sourceId: number,
  sourceName: string,
  brand: string,
  feedUrl: string,
  result: IngestResult,
): Promise<void> {
  const parser: Parser<unknown, RssItem> = new Parser({
    headers: { "User-Agent": USER_AGENT },
    timeout: 20_000,
  });
  try {
    const feed = await parser.parseURL(feedUrl);
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

async function pollGithubReleases(
  sourceId: number,
  sourceName: string,
  brand: string,
  repo: string,
  result: IngestResult,
): Promise<void> {
  try {
    const res = await fetchWith(`https://api.github.com/repos/${repo}/releases`, {
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
          title: `${brand} ${r.tag_name}${r.name && r.name !== r.tag_name ? `: ${r.name}` : ""}`,
          snippet: r.body ? r.body.slice(0, 1500) : null,
          author: r.author?.login ?? null,
          publishedAt,
          rawJson: { brand, repo, tag: r.tag_name, release_id: r.id },
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

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();

  // Read every enabled competitor source from DB. Adding a new competitor
  // is a SQL INSERT (or use /admin/competitors). No code change required.
  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.category, "competitor"), eq(sources.enabled, true)));

  // Build tasks based on each row's config_json.method.
  const tasks: Array<() => Promise<void>> = [];
  for (const src of rows) {
    const cfg = (src.configJson ?? {}) as Record<string, unknown>;
    const method = (cfg.method as string | undefined) ?? inferMethod(src.kind, cfg);
    const brand = (cfg.brand as string | undefined) ?? src.name;

    if (method === "google-news") {
      const query = cfg.query as string | undefined;
      if (!query) {
        result.errors.push(`source ${src.id} (${src.name}): missing config.query`);
        continue;
      }
      tasks.push(() => pollGoogleNews(src.id, src.name, brand, query, result));
    } else if (method === "rss") {
      const feedUrl = cfg.feedUrl as string | undefined;
      if (!feedUrl) {
        result.errors.push(`source ${src.id} (${src.name}): missing config.feedUrl`);
        continue;
      }
      tasks.push(() => pollRssBlog(src.id, src.name, brand, feedUrl, result));
    } else if (method === "github-releases") {
      const repo = cfg.repo as string | undefined;
      if (!repo) {
        result.errors.push(`source ${src.id} (${src.name}): missing config.repo`);
        continue;
      }
      tasks.push(() => pollGithubReleases(src.id, src.name, brand, repo, result));
    } else {
      result.errors.push(`source ${src.id} (${src.name}): unknown method '${method}'`);
    }
  }

  // Brand-level parallelization — bound concurrency to keep under 60s.
  for (let i = 0; i < tasks.length; i += BRAND_CONCURRENCY) {
    const batch = tasks.slice(i, i + BRAND_CONCURRENCY);
    await Promise.allSettled(batch.map((t) => t()));
  }

  return result;
}

/** Best-effort fallback if config_json.method is absent (legacy rows). */
function inferMethod(kind: string, cfg: Record<string, unknown>): string {
  if (cfg.repo) return "github-releases";
  if (cfg.feedUrl) return "rss";
  if (kind === "competitor-news") return "google-news";
  if (kind === "competitor-blog") return "rss";
  return "google-news";
}
