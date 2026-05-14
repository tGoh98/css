/**
 * Daily-close price cache for FIG (and friends). Yahoo aggressively
 * rate-limits Vercel IPs, so we cannot fetch at request time. Instead this
 * ingester runs hourly from GitHub Actions, pulls Yahoo's free chart JSON
 * from a wider/rotating IP pool, and upserts daily closes into
 * `chart_points`. The Official page reads from the DB.
 *
 * If Yahoo is unreachable on a given run, we no-op and keep whatever's in
 * the table. Stale data is preferable to no data.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { chartPoints } from "@/db/schema";
import { emptyResult, type IngestResult, USER_AGENT } from "./_shared";

const SYMBOLS = ["FIG"];
const RANGE = "1y"; // pull a year; idempotent upsert keeps the table small

type YahooChartResp = {
  chart?: {
    result?: Array<{
      meta?: { symbol?: string; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: number[] }> };
    }>;
  };
};

async function fetchYahooDaily(symbol: string): Promise<{
  symbol: string;
  currency?: string;
  points: { t: Date; c: number }[];
} | null> {
  // Two subdomains; if one is rate-limiting our caller IP, the other may not.
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${RANGE}&interval=1d`;
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json",
        },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as YahooChartResp;
      const r = json?.chart?.result?.[0];
      if (!r) continue;
      const ts = r.timestamp ?? [];
      const closes = r.indicators?.quote?.[0]?.close ?? [];
      const points: { t: Date; c: number }[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (c == null || !Number.isFinite(c)) continue;
        points.push({ t: new Date(ts[i] * 1000), c });
      }
      if (points.length === 0) continue;
      return { symbol: r.meta?.symbol ?? symbol, currency: r.meta?.currency, points };
    } catch {
      // try the next host
    }
  }
  return null;
}

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();
  for (const symbol of SYMBOLS) {
    const data = await fetchYahooDaily(symbol);
    if (!data) {
      result.errors.push(`chart: yahoo unreachable for ${symbol} (kept stale data)`);
      continue;
    }
    try {
      // Bulk upsert. Use ON CONFLICT to keep the row but update close — the
      // current day's close moves throughout the trading day.
      const values = data.points.map((p) => ({
        symbol: data.symbol,
        t: p.t,
        close: p.c.toFixed(4),
        currency: data.currency ?? null,
      }));
      // Drizzle doesn't support multi-row onConflict update across all cols
      // ergonomically, so we issue one statement with raw sql.unnest.
      await db
        .insert(chartPoints)
        .values(values)
        .onConflictDoUpdate({
          target: [chartPoints.symbol, chartPoints.t],
          set: {
            close: sql`excluded.close`,
            currency: sql`excluded.currency`,
            fetchedAt: sql`now()`,
          },
        });
      result.inserted += values.length;
    } catch (err) {
      result.errors.push(`chart: upsert ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
