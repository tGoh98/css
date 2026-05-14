import "server-only";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookmarks,
  itemClassifications,
  itemClusters,
  items,
  sources,
  watchlists,
} from "@/db/schema";
import type { FeedItem } from "./items";

export type WatchlistRow = typeof watchlists.$inferSelect;

export type WatchlistMatchConfig = {
  /** Case-insensitive keywords matched against title + snippet + one_line. Any match. */
  keywords?: string[];
  /** Optional regex-ish phrases (treated as plain LIKE patterns server-side). */
  authors?: string[];
  /** Restrict to specific source kinds. */
  kinds?: string[];
};

export async function listWatchlists(): Promise<WatchlistRow[]> {
  return db.select().from(watchlists).orderBy(desc(watchlists.createdAt));
}

/**
 * Fetch items matching a watchlist's `match_config_json`.
 *
 * Match semantics (best-effort, given the v1 single-blob config):
 *   - keywords → ILIKE OR across title / snippet / one_line
 *   - authors  → ILIKE OR against items.author
 *   - kinds    → restrict to those source kinds
 */
export async function fetchWatchlistItems(
  config: WatchlistMatchConfig,
  limit = 5,
): Promise<FeedItem[]> {
  const conds = [];

  if (config.keywords && config.keywords.length > 0) {
    const kwConds = config.keywords.map((kw) => {
      const pat = `%${kw.toLowerCase()}%`;
      return sql`(
        lower(coalesce(${items.title}, '')) like ${pat} or
        lower(coalesce(${items.snippet}, '')) like ${pat} or
        lower(coalesce(${itemClassifications.oneLine}, '')) like ${pat}
      )`;
    });
    conds.push(or(...kwConds));
  }
  if (config.authors && config.authors.length > 0) {
    const authorConds = config.authors.map(
      (a) => sql`lower(coalesce(${items.author}, '')) like ${"%" + a.toLowerCase() + "%"}`,
    );
    conds.push(or(...authorConds));
  }
  if (config.kinds && config.kinds.length > 0) {
    const kindConds = config.kinds.map((k) => eq(sources.kind, k));
    conds.push(or(...kindConds));
  }

  // Always cap to "recent enough" to keep watchlist views fresh.
  conds.push(gte(items.publishedAt, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)));

  const rows = await db
    .select({
      item: items,
      classification: itemClassifications,
      source: sources,
      cluster: itemClusters,
      bookmarked: sql<boolean>`${bookmarks.itemId} IS NOT NULL`.as("bookmarked"),
    })
    .from(items)
    .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .leftJoin(itemClusters, eq(itemClusters.id, items.clusterId))
    .leftJoin(bookmarks, eq(bookmarks.itemId, items.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(items.publishedAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, bookmarked: Boolean(r.bookmarked) }));
}
