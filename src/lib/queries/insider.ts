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
 * Pulls recent Form 4 filings from items.raw_json. The ingest worker is
 * expected to populate raw_json with at least `filing_type`, and may include
 * reporter name/role, transaction code, shares, and value. We coerce safely
 * and tolerate missing fields.
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
        sql`${items.rawJson}->>'filing_type' = '4'`,
      ),
    )
    .orderBy(desc(items.publishedAt))
    .limit(limit);

  return rows.map((r) => {
    const raw = (r.raw ?? {}) as Record<string, unknown>;
    const shares = toNum(raw.shares ?? raw.transaction_shares);
    const value = toNum(raw.value ?? raw.transaction_value ?? raw.total_value);
    const txRaw = String(raw.transaction_code ?? raw.transaction ?? "").toUpperCase();
    let transaction: InsiderTx["transaction"] = null;
    if (txRaw === "P" || txRaw === "PURCHASE") transaction = "purchase";
    else if (txRaw === "S" || txRaw === "SALE") transaction = "sale";
    else if (txRaw) transaction = "other";

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
