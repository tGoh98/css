import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FinnhubRecommendation } from "@/lib/queries/finnhub";

const BUCKETS = [
  { key: "strongBuy" as const, color: "var(--emerald-500, oklch(0.66 0.17 162))", label: "Strong Buy" },
  { key: "buy" as const, color: "var(--emerald-400, oklch(0.74 0.14 160))", label: "Buy" },
  { key: "hold" as const, color: "color-mix(in oklab, var(--muted-foreground) 60%, transparent)", label: "Hold" },
  { key: "sell" as const, color: "color-mix(in oklab, var(--destructive) 70%, transparent)", label: "Sell" },
  { key: "strongSell" as const, color: "var(--destructive)", label: "Strong Sell" },
];

/**
 * Server-rendered SVG stacked bar chart of monthly recommendation snapshots.
 * Oldest month on the left, newest on the right. Bars share a y-axis (total
 * analyst count); the user sees consensus drift over time.
 */
export function AnalystTrend({ rows }: { rows: FinnhubRecommendation[] }) {
  if (rows.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommendation trend</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Not enough monthly snapshots to plot a trend.
        </CardContent>
      </Card>
    );
  }

  // Newest first → oldest first for left-to-right reading.
  const series = [...rows].reverse().slice(-24); // cap to last 24 months
  const totals = series.map((r) => r.strongBuy + r.buy + r.hold + r.sell + r.strongSell);
  const maxTotal = Math.max(...totals, 1);

  const width = 900;
  const height = 200;
  const padding = { top: 12, right: 12, bottom: 36, left: 36 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barGap = 4;
  const barW = (innerW - barGap * (series.length - 1)) / series.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recommendation trend</CardTitle>
        <CardDescription>
          Monthly analyst-bucket counts · {series.length} month{series.length === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Recommendation trend over time">
          {/* y grid */}
          {[0, 0.5, 1].map((p, i) => {
            const v = Math.round(maxTotal * p);
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={padding.top + innerH * (1 - p)}
                  y2={padding.top + innerH * (1 - p)}
                  stroke="currentColor"
                  className="text-muted-foreground"
                  strokeOpacity="0.15"
                  strokeDasharray="2 4"
                />
                <text
                  x={padding.left - 6}
                  y={padding.top + innerH * (1 - p) + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="currentColor"
                  className="text-muted-foreground"
                  fillOpacity="0.7"
                >
                  {v}
                </text>
              </g>
            );
          })}

          {/* bars */}
          {series.map((r, i) => {
            const baseX = padding.left + i * (barW + barGap);
            let stackTop = padding.top + innerH; // start at the bottom
            return (
              <g key={r.period}>
                {BUCKETS.map((b) => {
                  const n = r[b.key];
                  if (n === 0) return null;
                  const h = (n / maxTotal) * innerH;
                  const yTop = stackTop - h;
                  const el = (
                    <rect
                      key={b.key}
                      x={baseX}
                      y={yTop}
                      width={barW}
                      height={h}
                      fill={b.color}
                    >
                      <title>{`${new Date(r.period).toLocaleDateString(undefined, { month: "short", year: "numeric" })} — ${b.label}: ${n}`}</title>
                    </rect>
                  );
                  stackTop = yTop;
                  return el;
                })}
              </g>
            );
          })}

          {/* x axis labels — show every Nth tick to avoid clutter */}
          {series.map((r, i) => {
            const step = Math.max(1, Math.ceil(series.length / 8));
            if (i % step !== 0 && i !== series.length - 1) return null;
            const cx = padding.left + i * (barW + barGap) + barW / 2;
            return (
              <text
                key={r.period}
                x={cx}
                y={height - 12}
                textAnchor="middle"
                fontSize="10"
                fill="currentColor"
                className="text-muted-foreground"
                fillOpacity="0.7"
              >
                {new Date(r.period).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}
              </text>
            );
          })}
        </svg>

        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {BUCKETS.map((b) => (
            <span key={b.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: b.color }} />
              {b.label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
