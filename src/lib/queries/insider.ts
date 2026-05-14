import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
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

export type InsiderFilter = {
  since?: Date | null;
  reporter?: string | null;
  limit?: number;
};

function whereForm4(filter: InsiderFilter) {
  const conds = [
    eq(sources.kind, "sec"),
    sql`${items.rawJson}->>'filing_type' in ('4', '4/A')`,
  ];
  if (filter.since) {
    conds.push(gte(items.publishedAt, filter.since));
  }
  if (filter.reporter) {
    conds.push(sql`${items.rawJson}->>'reporter_name' = ${filter.reporter}`);
  }
  return and(...conds);
}

/**
 * Pulls Form 4 filings, optionally filtered by reporter and a `since`
 * cutoff. `raw_json.filing_type = '4'` is populated both by the live SEC
 * ingester and by the normalized backfill. The Form 4 XML parser writes
 * `reporter_name`, `reporter_role`, `transaction`, `shares`, and `value`
 * directly — we read those fields verbatim.
 */
export async function fetchInsiderActivity(
  filter: InsiderFilter = {},
): Promise<InsiderTx[]> {
  const limit = filter.limit ?? 10;
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
    .where(whereForm4(filter))
    .orderBy(desc(items.publishedAt))
    .limit(limit);

  return rows.map((r) => {
    const raw = (r.raw ?? {}) as Record<string, unknown>;
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

/**
 * Count of Form 4 rows matching the filter — used to render
 * "Showing N of M filings" in the card header.
 */
export async function countInsiderActivity(
  filter: InsiderFilter = {},
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(whereForm4(filter));
  return row?.n ?? 0;
}

/**
 * Distinct list of reporter names across all Form 4 rows, sorted A→Z,
 * for the person-filter dropdown. NULL reporter names are omitted.
 */
export async function fetchInsiderReporters(): Promise<string[]> {
  const rows = await db
    .selectDistinct({
      name: sql<string>`${items.rawJson}->>'reporter_name'`,
    })
    .from(items)
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .where(
      and(
        eq(sources.kind, "sec"),
        sql`${items.rawJson}->>'filing_type' in ('4', '4/A')`,
        sql`${items.rawJson}->>'reporter_name' is not null`,
      ),
    )
    .orderBy(sql`${items.rawJson}->>'reporter_name'`);
  return rows.map((r) => r.name).filter((n): n is string => Boolean(n));
}

/**
 * @deprecated Use fetchInsiderActivity({ limit }) instead. Kept as a
 * thin alias while callers migrate.
 */
export async function fetchRecentInsiderActivity(limit = 10): Promise<InsiderTx[]> {
  return fetchInsiderActivity({ limit });
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
