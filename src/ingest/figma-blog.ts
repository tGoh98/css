/**
 * Figma blog poller.
 *
 * Verified 2026-05-13: `https://www.figma.com/blog/feed/` returns 404, as
 * does `/blog/rss/`. Falling back to scraping the HTML index page with
 * cheerio. We grab post cards (which include title, link, dek/snippet, and
 * publish date) and dedupe by URL.
 *
 * If Figma ships a real RSS feed later, swap the fetch path back.
 */
import * as cheerio from "cheerio";
import {
  ensureSource,
  fetchWith,
  insertAndClassify,
  markPolled,
  emptyResult,
  urlAsExternalId,
  type IngestResult,
} from "./_shared";

const BLOG_INDEX_URL = "https://www.figma.com/blog/";

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();

  const sourceId = await ensureSource({
    name: "Figma Blog",
    kind: "blog",
    category: "core",
    configJson: { indexUrl: BLOG_INDEX_URL, mode: "scrape" },
  });

  // First try the RSS path on the off-chance Figma adds it later. If it 404s,
  // proceed to scrape.
  let html: string;
  try {
    const res = await fetchWith(BLOG_INDEX_URL);
    html = await res.text();
  } catch (err) {
    result.errors.push(
      `figma-blog index fetch: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const candidates: Array<{
    url: string;
    title: string;
    snippet: string | null;
    publishedAt: Date | null;
  }> = [];

  // Strategy: find anchor tags whose href looks like /blog/<slug>, but ONLY
  // inside the .blog-body main content region. The sidebar (.blog-nav) is
  // full of single-word category links (/blog/events/, /blog/typography/,
  // etc.) that look like posts but aren't — pre-2026-05-14 versions of this
  // scraper pulled them all in.
  $(".blog-body a[href*='/blog/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = href.startsWith("http")
      ? href
      : `https://www.figma.com${href.startsWith("/") ? href : `/${href}`}`;
    let urlObj: URL;
    try {
      urlObj = new URL(abs);
    } catch {
      return;
    }
    if (!/^\/blog\/[^/]+\/?$/.test(urlObj.pathname)) return; // skip /blog/, /blog/category/*, etc.
    if (seen.has(urlObj.href)) return;
    seen.add(urlObj.href);

    const $el = $(el);
    const title =
      $el.find("h1,h2,h3,h4").first().text().trim() ||
      $el.attr("aria-label")?.trim() ||
      $el.text().trim();
    if (!title) return;

    // Look for dek/snippet text in the same card.
    const $card = $el.closest("article, li, div");
    const snippet =
      $card.find("p").first().text().trim() ||
      null;

    // Try to find a <time> element in the card.
    let publishedAt: Date | null = null;
    const timeAttr =
      $card.find("time").attr("datetime") ?? $card.find("time").text();
    if (timeAttr) {
      const d = new Date(timeAttr);
      if (!isNaN(d.getTime())) publishedAt = d;
    }

    candidates.push({
      url: urlObj.href,
      title,
      snippet: snippet && snippet !== title ? snippet : null,
      publishedAt,
    });
  });

  if (candidates.length === 0) {
    result.errors.push(
      `figma-blog: scrape returned 0 candidates; selectors may need updating`,
    );
  }

  // Cap + parallel — the index page can yield 50+ post anchors and a fresh
  // source would otherwise blow the 60s function cap on first ingest.
  const MAX_POSTS_PER_TICK = 25;
  const CONCURRENCY = 6;
  const slice = candidates.slice(0, MAX_POSTS_PER_TICK);
  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const batch = slice.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (c) => {
        await insertAndClassify(
          sourceId,
          "Figma Blog",
          "blog",
          {
            externalId: urlAsExternalId(c.url),
            url: c.url,
            title: c.title,
            snippet: c.snippet,
            // Fall back to now() if no date found — the AI classifier still works
            // and the user-visible "Recent" sort just treats it as "today".
            publishedAt: c.publishedAt ?? new Date(),
          },
          result,
        );
      }),
    );
  }

  await markPolled(sourceId);
  return result;
}
