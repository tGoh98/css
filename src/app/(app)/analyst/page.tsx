import { AnalystConsensus } from "@/components/analyst-consensus";
import { AnalystQuote } from "@/components/analyst-quote";
import { AnalystTrend } from "@/components/analyst-trend";
import { EarningsSurprise } from "@/components/earnings-surprise";
import {
  fetchEarningsHistory,
  fetchNextEarnings,
  fetchQuote,
  fetchRecommendations,
} from "@/lib/queries/finnhub";

export const dynamic = "force-dynamic";

const SYMBOL = "FIG";

export default async function AnalystPage() {
  const keyMissing = !process.env.FINNHUB_API_KEY;

  if (keyMissing) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Analyst</h1>
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1.5 py-0.5">FINNHUB_API_KEY</code> isn&apos;t set
          in this environment. Add it to your Vercel env vars (and to{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">.env.local</code> for local dev) to
          enable this tab.
        </p>
      </div>
    );
  }

  const [quote, next, recs, earnings] = await Promise.all([
    fetchQuote(SYMBOL),
    fetchNextEarnings(SYMBOL),
    fetchRecommendations(SYMBOL),
    fetchEarningsHistory(SYMBOL),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Analyst</h1>
        <p className="text-xs text-muted-foreground">
          Live quote, consensus coverage, and earnings track record for FIG · sourced from Finnhub
        </p>
      </div>

      <AnalystQuote quote={quote} next={next} />
      <AnalystConsensus rows={recs} />
      <AnalystTrend rows={recs} />
      <EarningsSurprise rows={earnings} />

      <p className="text-[11px] text-muted-foreground/80">
        Quote refreshes every ~60s; recommendation snapshots and earnings hourly. Premium
        Finnhub data (individual analyst upgrades/downgrades, price targets, estimate
        revisions) isn&apos;t included — those endpoints are paywalled.
      </p>
    </div>
  );
}
