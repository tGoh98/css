import "server-only";

/**
 * Finnhub helpers — pulls the free-tier endpoints we care about for the
 * Analyst tab. Free tier permits 60 req/min; we additionally cache each
 * response via Next's `fetch` revalidate so a tab refresh doesn't burn
 * a request.
 *
 * Premium-locked endpoints (intentionally NOT used here):
 * - /stock/price-target
 * - /stock/upgrade-downgrade
 * - /stock/insider-sentiment
 * - /stock/eps-estimate
 */

const BASE = "https://finnhub.io/api/v1";

export type FinnhubQuote = {
  /** Current price. */
  c: number;
  /** Day change. */
  d: number | null;
  /** Day change %. */
  dp: number | null;
  /** Day high. */
  h: number;
  /** Day low. */
  l: number;
  /** Day open. */
  o: number;
  /** Previous close. */
  pc: number;
  /** Quote timestamp (seconds). */
  t: number;
};

export type FinnhubRecommendation = {
  symbol: string;
  period: string; // YYYY-MM-DD (start of month)
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
};

export type FinnhubEarningsRow = {
  symbol: string;
  period: string; // quarter end YYYY-MM-DD
  year: number;
  quarter: number;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  surprisePercent: number | null;
};

export type FinnhubUpcomingEarnings = {
  symbol: string;
  date: string; // YYYY-MM-DD
  hour: "bmo" | "amc" | "dmh" | string | null; // before market open / after market close / during market hours
  quarter: number;
  year: number;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
};

function requireKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not configured");
  return key;
}

async function get<T>(path: string, revalidateSec: number): Promise<T | null> {
  const key = requireKey();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}token=${key}`;
  try {
    const res = await fetch(url, { next: { revalidate: revalidateSec } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchQuote(symbol: string): Promise<FinnhubQuote | null> {
  // Quote moves intraday; 60s is the sweet spot for "feels live" without
  // burning rate-limit on background page renders.
  const q = await get<FinnhubQuote>(`/quote?symbol=${encodeURIComponent(symbol)}`, 60);
  if (!q || !Number.isFinite(q.c) || q.c === 0) return null;
  return q;
}

/**
 * Monthly snapshot of analyst recommendations. Newest first.
 */
export async function fetchRecommendations(symbol: string): Promise<FinnhubRecommendation[]> {
  const rows = await get<FinnhubRecommendation[]>(
    `/stock/recommendation?symbol=${encodeURIComponent(symbol)}`,
    60 * 60, // 1 hr
  );
  return rows ?? [];
}

/**
 * Historical quarterly earnings beats/misses. Newest first.
 */
export async function fetchEarningsHistory(symbol: string): Promise<FinnhubEarningsRow[]> {
  const rows = await get<FinnhubEarningsRow[]>(
    `/stock/earnings?symbol=${encodeURIComponent(symbol)}`,
    60 * 60,
  );
  return rows ?? [];
}

/**
 * Pull the next ~12 months of scheduled earnings for the symbol. Returns the
 * single closest upcoming entry (if any).
 */
export async function fetchNextEarnings(symbol: string): Promise<FinnhubUpcomingEarnings | null> {
  const today = new Date().toISOString().slice(0, 10);
  const aYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const resp = await get<{ earningsCalendar: FinnhubUpcomingEarnings[] }>(
    `/calendar/earnings?from=${today}&to=${aYear}&symbol=${encodeURIComponent(symbol)}`,
    60 * 60,
  );
  const list = resp?.earningsCalendar ?? [];
  if (list.length === 0) return null;
  // Closest upcoming
  return list.sort((a, b) => a.date.localeCompare(b.date))[0];
}
