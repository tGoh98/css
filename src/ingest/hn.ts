/**
 * Hacker News poller via Algolia's free `search_by_date` endpoint.
 * No key required; ~10k req/h limit which is plenty.
 *
 * Watermark + paginate model: each tick computes the newest `published_at`
 * we have for this source and asks Algolia for items strictly newer, paging
 * until either (a) a page comes back fully-deduped, (b) Algolia returns a
 * short page (out of results), or (c) we hit `MAX_PAGES`. Steady state is
 * one short page; backlog after a spike walks deeper without losing items.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import {
  ensureSource,
  fetchWith,
  insertAndClassify,
  markPolled,
  emptyResult,
  type IngestResult,
} from "./_shared";

interface HNHit {
  objectID: string;
  title?: string;
  story_title?: string;
  url?: string;
  story_url?: string;
  author: string;
  created_at: string;
  created_at_i: number;
  story_text?: string;
  comment_text?: string;
  points?: number;
  num_comments?: number;
  _tags: string[];
}

interface HNResponse {
  hits: HNHit[];
}

const HITS_PER_PAGE = 50;
const MAX_PAGES = 4;
const CONCURRENCY = 6;
// Bootstrap window when the DB has no items for this source yet. Without a
// bound, Algolia would return every "Figma" story ever indexed and blow the
// classifier budget. 30 days is comfortably broader than any single tick gap.
const BOOTSTRAP_WINDOW_DAYS = 30;

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();

  const sourceId = await ensureSource({
    name: "Hacker News (Figma)",
    kind: "hn",
    category: "core",
    configJson: { query: "Figma", endpoint: "search_by_date" },
  });

  // Watermark = newest `created_at_i` already in DB for this source. Drizzle
  // doesn't expose max() over a timestamp directly across drivers without
  // some friction, so do it as a raw sql aggregate.
  const [watermarkRow] = await db
    .select({ ts: sql<Date | null>`max(${items.publishedAt})` })
    .from(items)
    .where(eq(items.sourceId, sourceId));

  const sinceEpoch = watermarkRow?.ts
    ? Math.floor(new Date(watermarkRow.ts).getTime() / 1000)
    : Math.floor((Date.now() - BOOTSTRAP_WINDOW_DAYS * 86_400_000) / 1000);

  let page = 0;
  let lastPageNewCount = 0;
  let lastPageHits = 0;
  for (page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      query: "Figma",
      tags: "story",
      hitsPerPage: String(HITS_PER_PAGE),
      page: String(page),
      numericFilters: `created_at_i>${sinceEpoch}`,
    });
    const url = `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;

    let resp: HNResponse;
    try {
      const res = await fetchWith(url);
      resp = (await res.json()) as HNResponse;
    } catch (err) {
      result.errors.push(
        `hn page ${page}: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }

    const hits = resp.hits ?? [];
    lastPageHits = hits.length;
    if (hits.length === 0) break;

    let pageNewCount = 0;
    for (let i = 0; i < hits.length; i += CONCURRENCY) {
      const batch = hits.slice(i, i + CONCURRENCY);
      const outcomes = await Promise.allSettled(
        batch.map(async (h) => {
          const title = h.title ?? h.story_title;
          if (!title) return "dedup" as const;
          const link =
            h.url ??
            h.story_url ??
            `https://news.ycombinator.com/item?id=${h.objectID}`;
          return await insertAndClassify(
            sourceId,
            "Hacker News (Figma)",
            "hn",
            {
              externalId: h.objectID,
              url: link,
              title,
              snippet:
                (h.story_text ?? h.comment_text ?? "").slice(0, 1500) || null,
              author: h.author,
              publishedAt: new Date(h.created_at_i * 1000),
              rawJson: {
                points: h.points ?? null,
                num_comments: h.num_comments ?? null,
                tags: h._tags,
                hn_id: h.objectID,
              },
            },
            result,
          );
        }),
      );
      for (const r of outcomes) {
        if (r.status === "fulfilled" && r.value !== "dedup") pageNewCount += 1;
      }
    }
    lastPageNewCount = pageNewCount;

    // Caught up: page returned but every item was already in DB.
    if (pageNewCount === 0) break;
    // Algolia is out of results matching the filter.
    if (hits.length < HITS_PER_PAGE) break;
  }

  // Reached the page cap with the final page still yielding new items. There
  // are likely more we haven't reached. Surfaced as a saturation warning.
  if (page >= MAX_PAGES && lastPageNewCount > 0 && lastPageHits === HITS_PER_PAGE) {
    result.warnings.push(
      `hn: SATURATED — walked ${MAX_PAGES} pages × ${HITS_PER_PAGE} and the last page still had ${lastPageNewCount} new items; raise MAX_PAGES or run a manual catch-up`,
    );
  }

  await markPolled(sourceId);
  return result;
}
