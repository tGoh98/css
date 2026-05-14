import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { itemClassifications, items, sources } from "@/db/schema";

/**
 * GET /api/search?q=...
 *
 * Postgres FTS over title + snippet + full_text + classifier one_line.
 * Returns up to 20 results, newest first within the tsquery match set.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ hits: [] });

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
