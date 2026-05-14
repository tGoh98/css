import "server-only";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { chartPoints } from "@/db/schema";

export type ChartPoint = { t: number; c: number };
export type ChartData = {
  symbol: string;
  range: string;
  points: ChartPoint[];
  currency?: string;
  /** Most recent `fetched_at` across the returned points (ms-since-epoch). */
  fetchedAt?: number;
};

/**
 * Read cached daily closes from `chart_points` for the requested symbol.
 * `range` accepts the same shorthand as Yahoo ('1mo','3mo','6mo','1y','2y','5y','max').
 */
export async function fetchChart(
  symbol: string,
  range: string = "3mo",
): Promise<ChartData | null> {
  const days = rangeToDays(range);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      t: chartPoints.t,
      close: chartPoints.close,
      currency: chartPoints.currency,
    })
    .from(chartPoints)
    .where(and(eq(chartPoints.symbol, symbol), gte(chartPoints.t, since)))
    .orderBy(asc(chartPoints.t));

  if (rows.length === 0) return null;

  // Most recent fetched_at across the symbol — drives the "polled at" disclaimer.
  const [latest] = await db
    .select({ fetchedAt: chartPoints.fetchedAt })
    .from(chartPoints)
    .where(eq(chartPoints.symbol, symbol))
    .orderBy(desc(chartPoints.fetchedAt))
    .limit(1);

  return {
    symbol,
    range,
    currency: rows[0].currency ?? undefined,
    points: rows.map((r) => ({ t: r.t.getTime(), c: Number(r.close) })),
    fetchedAt: latest?.fetchedAt.getTime(),
  };
}

function rangeToDays(range: string): number {
  switch (range) {
    case "1mo": return 31;
    case "3mo": return 92;
    case "6mo": return 183;
    case "1y": return 366;
    case "2y": return 732;
    case "5y": return 1830;
    case "max": return 36500;
    default: return 92;
  }
}
