/**
 * Backfill the Figma blog archive by scraping the paginated index.
 *
 *   tsx scripts/backfill/figma-blog.ts [--limit N]
 *
 * Walks `https://www.figma.com/blog?page=N` from N=1 until a page either
 * returns an HTTP error or yields no article links. Uses cheerio for parsing.
 */

import { load as loadHtml } from "cheerio";
import {
  classifyAndStore,
  ensureSource,
  insertBackfilledItem,
  parseFlags,
  sleep,
} from "./_common";

type Post = {
  url: string;
  title: string;
  snippet: string | null;
  publishedAt: Date | null;
  author: string | null;
};

const ORIGIN = "https://www.figma.com";
const UA = "Mozilla/5.0 (compatible; CSS-Backfill/0.1; +https://github.com/tGoh98)";

async function fetchPage(page: number): Promise<string | null> {
  const url = `${ORIGIN}/blog/?page=${page}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) return null;
  return res.text();
}

function parseIndex(html: string): Post[] {
  const $ = loadHtml(html);
  const seen = new Set<string>();
  const posts: Post[] = [];
  // Try a broad selector — any anchor pointing into /blog/<slug>/ with text.
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const m = href.match(/^(?:https?:\/\/(?:www\.)?figma\.com)?\/blog\/([^/?#]+)\/?$/);
    if (!m) return;
    const slug = m[1];
    if (["page", "tag", "category", "feed"].includes(slug)) return;
    const url = href.startsWith("http") ? href : `${ORIGIN}${href}`;
    if (seen.has(url)) return;
    seen.add(url);
    const title = $(el).text().trim();
    if (!title || title.length < 6) return;
    posts.push({ url, title, snippet: null, publishedAt: null, author: null });
  });
  return posts;
}

async function fetchPostDetail(post: Post): Promise<Post> {
  try {
    const res = await fetch(post.url, { headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!res.ok) return post;
    const html = await res.text();
    const $ = loadHtml(html);
    const ogDescription =
      $('meta[property="og:description"]').attr("content") ??
      $('meta[name="description"]').attr("content") ??
      null;
    const ogTitle = $('meta[property="og:title"]').attr("content") ?? null;
    const publishedRaw =
      $('meta[property="article:published_time"]').attr("content") ??
      $('meta[itemprop="datePublished"]').attr("content") ??
      $("time[datetime]").first().attr("datetime") ??
      null;
    const author =
      $('meta[name="author"]').attr("content") ??
      $('meta[property="article:author"]').attr("content") ??
      null;
    return {
      url: post.url,
      title: ogTitle?.trim() || post.title,
      snippet: ogDescription?.trim() ?? null,
      publishedAt: publishedRaw ? new Date(publishedRaw) : null,
      author: author?.trim() ?? null,
    };
  } catch {
    return post;
  }
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const limit = flags.limit ?? Number.POSITIVE_INFINITY;

  const sourceId = await ensureSource({
    name: "Figma blog",
    kind: "blog",
    category: "core",
    configJson: { url: `${ORIGIN}/blog/` },
  });

  let page = 1;
  let scanned = 0;
  let kept = 0;
  let consecutiveEmpty = 0;

  while (kept < limit && consecutiveEmpty < 2) {
    const html = await fetchPage(page);
    if (html === null) {
      console.log(`[backfill:figma-blog] page ${page} not available; stopping`);
      break;
    }
    const posts = parseIndex(html);
    if (posts.length === 0) {
      consecutiveEmpty++;
      console.log(`[backfill:figma-blog] page ${page} had no posts (consecutive empty=${consecutiveEmpty})`);
      page++;
      continue;
    }
    consecutiveEmpty = 0;
    console.log(`[backfill:figma-blog] page ${page}: ${posts.length} posts`);
    for (const stub of posts) {
      if (kept >= limit) break;
      scanned++;
      const post = await fetchPostDetail(stub);
      const externalId = `figma-blog:${stub.url.replace(/\/$/, "").split("/").pop()}`;
      const itemId = await insertBackfilledItem({
        sourceId,
        externalId,
        url: post.url,
        title: post.title,
        snippet: post.snippet,
        author: post.author,
        publishedAt: post.publishedAt ?? new Date(),
        rawJson: { source: "figma-blog", url: post.url },
      });
      if (itemId) {
        await classifyAndStore({
          itemId,
          title: post.title,
          snippet: post.snippet,
          url: post.url,
          sourceName: "Figma blog",
          sourceKind: "blog",
        });
        kept++;
      }
      await sleep(150);
    }
    page++;
    await sleep(400);
  }

  console.log(`[backfill:figma-blog] done scanned=${scanned} inserted=${kept}`);
}

main().catch((err) => {
  console.error("[backfill:figma-blog] failed:", err);
  process.exit(1);
});
