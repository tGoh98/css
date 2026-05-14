import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, sources } from "@/db/schema";

export type InsiderTx = {
  itemId: number;
  filedAt: Date;
  name: string | null;
  role: string | null;
  transaction: "purchase" | "sale" | "other" | null;
  shares: number | null;
  value: number | null;
  url: string;
};

/**
 * Pulls recent Form 4 filings. `raw_json.filing_type = '4'` is populated
 * both by the live SEC ingester and by the normalized backfill. The
 * Form 4 XML parser writes `reporter_name`, `reporter_role`, `transaction`,
 * `shares`, and `value` directly — we read those fields verbatim.
 */
export async function fetchRecentInsiderActivity(limit = 10): Promise<InsiderTx[]> {
  const rows = await db
    .select({
      id: items.id,
      url: items.url,
      title: items.title,
      author: items.author,
      publishedAt: items.publishedAt,
      raw: items.rawJson,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        eq(sources.kind, "sec"),
        sql`${items.rawJson}->>'filing_type' in ('4', '4/A')`,
      ),
    )
    .orderBy(desc(items.publishedAt))
    .limit(limit);

  return rows.map((r) => {
    const raw = (r.raw ?? {}) as Record<string, unknown>;
    // Direction lives on `transaction`; show absolute share counts in the UI.
    const sharesRaw = toNum(raw.shares);
    const shares = sharesRaw == null ? null : Math.abs(sharesRaw);
    const value = toNum(raw.value);
    const t = raw.transaction;
    let transaction: InsiderTx["transaction"] = null;
    if (t === "purchase" || t === "sale" || t === "other") transaction = t;

    return {
      itemId: r.id,
      filedAt: r.publishedAt,
      name: (raw.reporter_name as string | undefined) ?? r.author ?? null,
      role: (raw.reporter_role as string | undefined) ?? null,
      transaction,
      shares,
      value,
      url: r.url,
    };
  });
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
