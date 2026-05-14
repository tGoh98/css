import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FinnhubQuote, FinnhubUpcomingEarnings } from "@/lib/queries/finnhub";

function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${n.toFixed(digits)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtRevenue(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function hourLabel(h: string | null): string {
  if (h === "bmo") return "before market open";
  if (h === "amc") return "after market close";
  if (h === "dmh") return "during market hours";
  return "time TBD";
}

export function AnalystQuote({
  quote,
  next,
}: {
  quote: FinnhubQuote | null;
  next: FinnhubUpcomingEarnings | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">FIG · Live quote & next earnings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Quote</div>
            {quote ? (
              <>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-3xl font-semibold tabular-nums">{fmtUsd(quote.c)}</span>
                  <span
                    className={
                      (quote.d ?? 0) >= 0
                        ? "text-sm font-medium text-emerald-600"
                        : "text-sm font-medium text-destructive"
                    }
                  >
                    {fmtUsd(quote.d)} ({fmtPct(quote.dp)})
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Open</dt>
                  <dd className="text-right tabular-nums">{fmtUsd(quote.o)}</dd>
                  <dt className="text-muted-foreground">Prev close</dt>
                  <dd className="text-right tabular-nums">{fmtUsd(quote.pc)}</dd>
                  <dt className="text-muted-foreground">High</dt>
                  <dd className="text-right tabular-nums">{fmtUsd(quote.h)}</dd>
                  <dt className="text-muted-foreground">Low</dt>
                  <dd className="text-right tabular-nums">{fmtUsd(quote.l)}</dd>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Quote unavailable.</p>
            )}
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Next earnings</div>
            {next ? (
              <>
                <div className="mt-1 text-2xl font-semibold">
                  {new Date(next.date).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
                <div className="text-xs text-muted-foreground">
                  Q{next.quarter} {next.year} · {hourLabel(next.hour)}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">EPS estimate</dt>
                  <dd className="text-right tabular-nums">{fmtUsd(next.epsEstimate, 3)}</dd>
                  <dt className="text-muted-foreground">Revenue estimate</dt>
                  <dd className="text-right tabular-nums">{fmtRevenue(next.revenueEstimate)}</dd>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No upcoming earnings scheduled.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
