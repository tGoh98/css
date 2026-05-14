import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FinnhubRecommendation } from "@/lib/queries/finnhub";

type Bucket = { key: keyof Pick<FinnhubRecommendation, "strongBuy" | "buy" | "hold" | "sell" | "strongSell">; label: string; color: string };

const BUCKETS: Bucket[] = [
  { key: "strongBuy", label: "Strong Buy", color: "bg-emerald-500" },
  { key: "buy", label: "Buy", color: "bg-emerald-400/80" },
  { key: "hold", label: "Hold", color: "bg-muted-foreground/50" },
  { key: "sell", label: "Sell", color: "bg-destructive/70" },
  { key: "strongSell", label: "Strong Sell", color: "bg-destructive" },
];

/**
 * Reduce a recommendation snapshot to a single human label. Same logic
 * brokerages use: weighted mean over the 5 buckets (strongBuy=1 … strongSell=5)
 * then bin into 5 categories.
 */
function consensusLabel(r: FinnhubRecommendation): string {
  const total = r.strongBuy + r.buy + r.hold + r.sell + r.strongSell;
  if (total === 0) return "—";
  const score =
    (1 * r.strongBuy + 2 * r.buy + 3 * r.hold + 4 * r.sell + 5 * r.strongSell) / total;
  if (score <= 1.5) return "Strong Buy";
  if (score <= 2.5) return "Buy";
  if (score <= 3.5) return "Hold";
  if (score <= 4.5) return "Sell";
  return "Strong Sell";
}

export function AnalystConsensus({ rows }: { rows: FinnhubRecommendation[] }) {
  const latest = rows[0] ?? null;
  if (!latest) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyst consensus</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No analyst coverage data.</CardContent>
      </Card>
    );
  }
  const total = latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell;
  const consensus = consensusLabel(latest);

  // Compare to previous month for trend annotation
  const prev = rows[1] ?? null;
  let trend: { label: string; delta: number } | null = null;
  if (prev) {
    const prevTotal = prev.strongBuy + prev.buy + prev.hold + prev.sell + prev.strongSell;
    const prevConsensus = consensusLabel(prev);
    trend = {
      label: prevConsensus,
      delta: total - prevTotal,
    };
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <CardTitle className="text-base">Analyst consensus</CardTitle>
            <CardDescription>
              {total} analyst{total === 1 ? "" : "s"} · current month ({new Date(latest.period).toLocaleDateString(undefined, { month: "short", year: "numeric" })})
              {trend && trend.label !== consensus ? (
                <span className="ml-2 text-foreground/80">
                  · shifted from <span className="font-medium">{trend.label}</span>
                </span>
              ) : null}
              {trend && trend.delta !== 0 ? (
                <span className="ml-1 text-muted-foreground/70">({trend.delta > 0 ? "+" : ""}{trend.delta} coverage)</span>
              ) : null}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Consensus</div>
            <div className={`text-lg font-semibold ${consensus.startsWith("Strong Buy") || consensus === "Buy" ? "text-emerald-600" : consensus.startsWith("Strong Sell") || consensus === "Sell" ? "text-destructive" : "text-foreground"}`}>
              {consensus}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Stacked horizontal bar */}
        <div className="flex h-6 w-full overflow-hidden rounded-md border border-border">
          {BUCKETS.map((b) => {
            const n = latest[b.key];
            if (n === 0) return null;
            const pct = (n / total) * 100;
            return (
              <div
                key={b.key}
                className={`flex items-center justify-center ${b.color}`}
                style={{ width: `${pct}%` }}
                title={`${b.label}: ${n}`}
              >
                {pct > 10 ? (
                  <span className="text-[10px] font-medium text-white drop-shadow-sm">{n}</span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Legend with counts */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {BUCKETS.map((b) => {
            const n = latest[b.key];
            return (
              <span key={b.key} className="flex items-center gap-1.5">
                <span className={`inline-block size-2 rounded-sm ${b.color}`} />
                {b.label}: <span className="font-medium text-foreground">{n}</span>
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
