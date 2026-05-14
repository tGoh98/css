import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bookmarks,
  itemClassifications,
  itemClusters,
  items,
  sources,
} from "@/db/schema";

export type ItemRow = typeof items.$inferSelect;
export type ClassificationRow = typeof itemClassifications.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;
export type ClusterRow = typeof itemClusters.$inferSelect;

export type FeedItem = {
  item: ItemRow;
  classification: ClassificationRow | null;
  source: SourceRow | null;
  cluster: ClusterRow | null;
  /** Bookmarked by the current user (joined externally if a user is supplied). */
  bookmarked: boolean;
  /** Total items in the cluster (only set when grouping is on). */
  clusterCount?: number;
};

export type FeedFilter = {
  sourceId?: number;
  priority?: "routine" | "notable" | "breaking";
  since?: Date | null;
  /** Restrict to a category, e.g. 'competitor'. */
  category?: string;
  /** Restrict to source kinds, e.g. ['sec', 'blog']. */
  kinds?: string[];
  /** Match competitor brand by sources.name (case-insensitive substring). */
  brand?: string;
  /** Search query (FTS). */
  q?: string;
  /** Restrict to bookmarked items only. */
  onlyBookmarked?: boolean;
};

const baseSelect = {
  item: items,
  classification: itemClassifications,
  source: sources,
  cluster: itemClusters,
  bookmarked: sql<boolean>`${bookmarks.itemId} IS NOT NULL`.as("bookmarked"),
};

function buildWhere(filter: FeedFilter) {
  const conds = [];
  if (filter.sourceId) conds.push(eq(items.sourceId, filter.sourceId));
  if (filter.priority) conds.push(eq(itemClassifications.priority, filter.priority));
  if (filter.since) conds.push(gte(items.publishedAt, filter.since));
  if (filter.category) conds.push(eq(sources.category, filter.category));
  if (filter.kinds && filter.kinds.length > 0) conds.push(inArray(sources.kind, filter.kinds));
  if (filter.brand)
    conds.push(sql`lower(${sources.name}) like ${"%" + filter.brand.toLowerCase() + "%"}`);
  if (filter.q && filter.q.trim()) {
    const q = filter.q.trim();
    conds.push(
      sql`to_tsvector('english',
        coalesce(${items.title}, '') || ' ' ||
        coalesce(${items.snippet}, '') || ' ' ||
        coalesce(${items.fullText}, '') || ' ' ||
        coalesce(${itemClassifications.oneLine}, '')
      ) @@ plainto_tsquery('english', ${q})`,
    );
  }
  if (filter.onlyBookmarked) {
    conds.push(sql`${bookmarks.itemId} IS NOT NULL`);
  }
  return conds.length > 0 ? and(...conds) : undefined;
}

/**
 * Paginated feed query. Groups by `cluster_id` when `groupByCluster` is true —
 * we pick the most-recent item per cluster as the representative.
 */
export async function fetchFeed(
  filter: FeedFilter,
  opts: { limit?: number; offset?: number; groupByCluster?: boolean } = {},
): Promise<FeedItem[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const groupByCluster = opts.groupByCluster ?? true;

  if (!groupByCluster) {
    const rows = await db
      .select(baseSelect)
      .from(items)
      .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
      .leftJoin(sources, eq(sources.id, items.sourceId))
      .leftJoin(itemClusters, eq(itemClusters.id, items.clusterId))
      .leftJoin(bookmarks, eq(bookmarks.itemId, items.id))
      .where(buildWhere(filter))
      .orderBy(desc(items.publishedAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({ ...r, bookmarked: Boolean(r.bookmarked) }));
  }

  // Grouped: use DISTINCT ON (cluster_id, id) — pick the latest item per
  // cluster_id (and keep ungrouped items as themselves via id fallback).
  const where = buildWhere(filter);
  const rows = await db
    .select({
      ...baseSelect,
      clusterCount: sql<number>`(
        select count(*)::int from ${items} i2
        where i2.cluster_id is not null and i2.cluster_id = ${items.clusterId}
      )`.as("cluster_count"),
    })
    .from(items)
    .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .leftJoin(itemClusters, eq(itemClusters.id, items.clusterId))
    .leftJoin(bookmarks, eq(bookmarks.itemId, items.id))
    .where(
      where
        ? and(
            where,
            sql`(
              ${items.clusterId} is null or ${items.id} = (
                select max(i3.id) from ${items} i3 where i3.cluster_id = ${items.clusterId}
              )
            )`,
          )
        : sql`(
            ${items.clusterId} is null or ${items.id} = (
              select max(i3.id) from ${items} i3 where i3.cluster_id = ${items.clusterId}
            )
          )`,
    )
    .orderBy(desc(items.publishedAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...r,
    bookmarked: Boolean(r.bookmarked),
    clusterCount: r.clusterCount ?? undefined,
  }));
}

export async function listSources(): Promise<SourceRow[]> {
  return db.select().from(sources).orderBy(sources.name);
}

export async function fetchItemById(id: number): Promise<FeedItem | null> {
  const [row] = await db
    .select(baseSelect)
    .from(items)
    .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .leftJoin(itemClusters, eq(itemClusters.id, items.clusterId))
    .leftJoin(bookmarks, eq(bookmarks.itemId, items.id))
    .where(eq(items.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row, bookmarked: Boolean(row.bookmarked) };
}

export async function searchItems(q: string, limit = 20): Promise<FeedItem[]> {
  if (!q.trim()) return [];
  return fetchFeed({ q }, { limit, groupByCluster: false });
}
