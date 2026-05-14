import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { itemClassifications, items, sources } from "@/db/schema";

/**
 * GET /api/search?q=...
 *
 * Postgres FTS over title + snippet + full_text + classifier one_line.
 * Returns up to 20 results, newest first within the tsquery match set.
 *
 * Public — the rest of the site is unauthenticated read-only display of
 * the same data, so there's no point gating search.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ hits: [] });
  // Cheap DoS bound — Postgres FTS handles long queries fine but no point
  // letting attackers send 1MB of tsquery garbage every request.
  if (q.length > 200) {
    return NextResponse.json({ error: "query too long" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      url: items.url,
      publishedAt: items.publishedAt,
      source: sources.name,
      oneLine: itemClassifications.oneLine,
      priority: itemClassifications.priority,
    })
    .from(items)
    .leftJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(
      sql`to_tsvector('english',
        coalesce(${items.title}, '') || ' ' ||
        coalesce(${items.snippet}, '') || ' ' ||
        coalesce(${items.fullText}, '') || ' ' ||
        coalesce(${itemClassifications.oneLine}, '')
      ) @@ plainto_tsquery('english', ${q})`,
    )
    .orderBy(desc(items.publishedAt))
    .limit(20);

  return NextResponse.json({
    hits: rows.map((r) => ({
      id: r.id,
      title: r.title,
      url: r.url,
      source: r.source,
      oneLine: r.oneLine,
      priority: r.priority,
      publishedAt: r.publishedAt.toISOString(),
    })),
  });
}
