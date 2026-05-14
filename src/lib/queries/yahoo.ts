import "server-only";

export type ChartPoint = { t: number; c: number };
export type ChartData = {
  symbol: string;
  range: string;
  points: ChartPoint[];
  currency?: string;
};

/**
 * Yahoo's unofficial chart API. No key, but we treat it as best-effort —
 * if it 4xx/5xx we degrade gracefully. Always called server-side.
 */
export async function fetchYahooChart(
  symbol: string,
  range: string = "3mo",
  interval: string = "1d",
): Promise<ChartData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const res = await fetch(url, {
      headers: {
        // Some Yahoo endpoints 401 without a UA.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        accept: "application/json",
      },
      next: { revalidate: 60 * 15 }, // cache 15 min
    });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooChartResp;
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const ts = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const points: ChartPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c == null || !Number.isFinite(c)) continue;
      points.push({ t: ts[i] * 1000, c });
    }
    return {
      symbol: result.meta?.symbol ?? symbol,
      range,
      points,
      currency: result.meta?.currency,
    };
  } catch {
    return null;
  }
}

export type AnalystSnapshot = {
  symbol: string;
  recommendationKey?: string;
  recommendationMean?: number;
  numberOfAnalystOpinions?: number;
  targetMean?: number;
  targetHigh?: number;
  targetLow?: number;
  targetMedian?: number;
  currentPrice?: number;
};

/**
 * Pull analyst consensus + price targets from Yahoo's `quoteSummary` endpoint.
 * Modules: `financialData,recommendationTrend`.
 */
export async function fetchYahooAnalyst(symbol: string): Promise<AnalystSnapshot | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,recommendationTrend`;
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        accept: "application/json",
      },
      next: { revalidate: 60 * 60 }, // cache 1 hr
    });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooQuoteSummaryResp;
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return null;
    const fd = result.financialData;
    return {
      symbol,
      recommendationKey: rawVal(fd?.recommendationKey),
      recommendationMean: numVal(fd?.recommendationMean),
      numberOfAnalystOpinions: numVal(fd?.numberOfAnalystOpinions),
      targetMean: numVal(fd?.targetMeanPrice),
      targetHigh: numVal(fd?.targetHighPrice),
      targetLow: numVal(fd?.targetLowPrice),
      targetMedian: numVal(fd?.targetMedianPrice),
      currentPrice: numVal(fd?.currentPrice),
    };
  } catch {
    return null;
  }
}

function numVal(field: { raw?: number } | number | undefined): number | undefined {
  if (field == null) return undefined;
  if (typeof field === "number") return Number.isFinite(field) ? field : undefined;
  return typeof field.raw === "number" ? field.raw : undefined;
}

function rawVal(field: { raw?: string } | string | undefined): string | undefined {
  if (field == null) return undefined;
  if (typeof field === "string") return field;
  return field.raw;
}

// --- Minimal types we accept from Yahoo's responses. They're permissive on
// purpose — Yahoo is famously fickle and we don't want a schema change there
// to crash the page.

type YahooChartResp = {
  chart?: {
    result?: Array<{
      meta?: { symbol?: string; currency?: string };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: number[] }> };
    }>;
  };
};

type YahooQuoteSummaryResp = {
  quoteSummary?: {
    result?: Array<{
      financialData?: {
        currentPrice?: { raw?: number } | number;
        targetMeanPrice?: { raw?: number } | number;
        targetHighPrice?: { raw?: number } | number;
        targetLowPrice?: { raw?: number } | number;
        targetMedianPrice?: { raw?: number } | number;
        recommendationKey?: { raw?: string } | string;
        recommendationMean?: { raw?: number } | number;
        numberOfAnalystOpinions?: { raw?: number } | number;
      };
    }>;
  };
};
