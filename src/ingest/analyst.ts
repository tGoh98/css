/**
 * Analyst-signal poller for the FIG ticker.
 *
 * Two upstreams, both flaky in different ways:
 *
 *   1. Yahoo Finance quoteSummary — unofficial endpoint that as of late 2025
 *      requires a session "crumb" cookie. We try a plain GET first with a
 *      browser-like UA; if Yahoo returns 401/Unauthorized we record the
 *      error and move on. Successful responses are mined for analyst
 *      upgrades/downgrades and consensus recommendation trend.
 *
 *   2. Seeking Alpha — they publish per-ticker XML at the `/combined/<T>.xml`
 *      path. Verified 2026-05-13: returns 200 with content-type
 *      application/xml. We parse with rss-parser.
 *
 * Each upstream is wrapped in its own try/catch so partial failure is OK.
 */
import Parser from "rss-parser";
import {
  ensureSource,
  fetchWith,
  insertAndClassify,
  markPolled,
  emptyResult,
  USER_AGENT,
  type IngestResult,
} from "./_shared";

const YF_URL =
  "https://query1.finance.yahoo.com/v10/finance/quoteSummary/FIG?modules=upgradeDowngradeHistory,recommendationTrend";
// Verified 2026-05-13: HEAD returns 200 OK with content-type application/xml.
const SA_URL = "https://seekingalpha.com/api/sa/combined/FIG.xml";

const BROWSER_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  USER_AGENT,
];

interface YahooQuoteSummary {
  quoteSummary: {
    result: Array<{
      upgradeDowngradeHistory?: {
        history: Array<{
          epochGradeDate: number;
          firm: string;
          toGrade: string;
          fromGrade: string;
          action: string; // 'main' | 'up' | 'down' | 'init' | 'reit'
        }>;
      };
      recommendationTrend?: {
        trend: Array<{
          period: string;
          strongBuy: number;
          buy: number;
          hold: number;
          sell: number;
          strongSell: number;
        }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

async function pollYahoo(result: IngestResult): Promise<void> {
  const sourceName = "Yahoo Finance analyst (FIG)";
  const sourceId = await ensureSource({
    name: sourceName,
    kind: "news",
    category: "core",
    configJson: { ticker: "FIG", endpoint: YF_URL },
  });

  let data: YahooQuoteSummary | null = null;
  let lastErr: string | null = null;
  for (const ua of BROWSER_UAS) {
    try {
      const res = await fetchWith(YF_URL, {}, ua);
      data = (await res.json()) as YahooQuoteSummary;
      if (data.quoteSummary?.error) {
        lastErr = data.quoteSummary.error.description;
        data = null;
        continue;
      }
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  if (!data || !data.quoteSummary?.result || data.quoteSummary.result.length === 0) {
    result.errors.push(
      `yahoo-analyst: ${lastErr ?? "unknown error"} (endpoint requires crumb cookie; will retry next tick)`,
    );
    return;
  }

  const block = data.quoteSummary.result[0];
  const history = block.upgradeDowngradeHistory?.history ?? [];

  for (const h of history) {
    const ts = new Date(h.epochGradeDate * 1000);
    const title = `${h.firm}: ${h.fromGrade || "?"} → ${h.toGrade || "?"} on FIG (${h.action})`;
    const externalId = `yf-grade:${h.firm}:${h.epochGradeDate}:${h.toGrade}`;
    await insertAndClassify(
      sourceId,
      sourceName,
      "news",
      {
        externalId,
        url: "https://finance.yahoo.com/quote/FIG/analysis",
        title,
        snippet: `Analyst rating change at ${h.firm}: ${h.fromGrade || "—"} → ${h.toGrade || "—"} (${h.action}).`,
        publishedAt: ts,
        rawJson: { kind: "analyst-rating", ...h },
      },
      result,
    );
  }

  await markPolled(sourceId);
}

async function pollSeekingAlpha(result: IngestResult): Promise<void> {
  const sourceName = "Seeking Alpha (FIG)";
  const sourceId = await ensureSource({
    name: sourceName,
    kind: "news",
    category: "core",
    configJson: { ticker: "FIG", feedUrl: SA_URL },
  });

  interface SAItem {
    title?: string;
    link?: string;
    pubDate?: string;
    isoDate?: string;
    contentSnippet?: string;
    creator?: string;
    guid?: string;
  }

  const parser: Parser<unknown, SAItem> = new Parser({
    headers: { "User-Agent": USER_AGENT },
    timeout: 20_000,
  });

  try {
    const feed = await parser.parseURL(SA_URL);
    for (const entry of feed.items as SAItem[]) {
      if (!entry.title || !entry.link) continue;
      const publishedAt = entry.isoDate
        ? new Date(entry.isoDate)
        : entry.pubDate
          ? new Date(entry.pubDate)
          : new Date();
      await insertAndClassify(
        sourceId,
        sourceName,
        "news",
        {
          externalId: entry.guid ?? entry.link,
          url: entry.link,
          title: entry.title,
          snippet: entry.contentSnippet ?? null,
          author: entry.creator ?? null,
          publishedAt,
          rawJson: { ticker: "FIG", source: "seeking-alpha", raw: entry as unknown as Record<string, unknown> },
        },
        result,
      );
    }
    await markPolled(sourceId);
  } catch (err) {
    result.errors.push(
      `seeking-alpha: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function ingest(): Promise<IngestResult> {
  const result = emptyResult();
  await pollYahoo(result);
  await pollSeekingAlpha(result);
  return result;
}
