import type { ChartData } from "@/lib/queries/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type ChartEvent = {
  /** ms-since-epoch. */
  t: number;
  title: string;
  url: string;
  priority?: "routine" | "notable" | "breaking" | null;
};

/**
 * Server-rendered SVG line chart for FIG with event markers overlaid.
 *
 * Intentionally minimal — no client JS, no deps. Hover tooltips via plain
 * <title> tags on the SVG circles (browser-native).
 */
export function FigChart({
  data,
  events = [],
  height = 260,
  caption,
}: {
  data: ChartData | null;
  events?: ChartEvent[];
  height?: number;
  caption?: string;
}) {
  if (!data || data.points.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>FIG</CardTitle>
          <CardDescription>{caption ?? "Chart unavailable"}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No chart data yet — the hourly cron will populate this after the next run.
        </CardContent>
      </Card>
    );
  }

  const width = 900;
  const padding = { top: 16, right: 16, bottom: 24, left: 44 };

  const xs = data.points.map((p) => p.t);
  const ys = data.points.map((p) => p.c);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.08 || 1;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const x = (t: number) => padding.left + ((t - xMin) / (xMax - xMin || 1)) * innerW;
  const y = (c: number) => padding.top + innerH - ((c - yLo) / (yHi - yLo || 1)) * innerH;

  const path = data.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.c).toFixed(1)}`)
    .join(" ");

  // Pair events to nearest price for marker Y position
  const inRange = events.filter((e) => e.t >= xMin && e.t <= xMax);
  const eventMarkers = inRange.map((ev) => {
    // nearest point by time
    let best = data.points[0];
    let bestDist = Math.abs(best.t - ev.t);
    for (const p of data.points) {
      const d = Math.abs(p.t - ev.t);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return { ev, px: x(ev.t), py: y(best.c) };
  });

  const last = data.points[data.points.length - 1];
  const first = data.points[0];
  const change = last.c - first.c;
  const changePct = (change / first.c) * 100;

  // y-axis ticks: 4 evenly spaced
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => yLo + p * (yHi - yLo));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <CardTitle className="text-base">FIG · ${last.c.toFixed(2)}</CardTitle>
            <CardDescription>
              <span className={change >= 0 ? "text-emerald-600" : "text-destructive"}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)} ({changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%)
              </span>{" "}
              · {data.range} · {caption ?? "Daily close"}
            </CardDescription>
          </div>
          <Legend />
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full text-muted-foreground"
          role="img"
          aria-label={`FIG ${data.range} chart`}
        >
          {/* grid */}
          {ticks.map((tickVal, idx) => (
            <g key={idx}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(tickVal)}
                y2={y(tickVal)}
                stroke="currentColor"
                strokeOpacity="0.15"
                strokeDasharray="2 4"
              />
              <text
                x={padding.left - 6}
                y={y(tickVal) + 3}
                textAnchor="end"
                fontSize="10"
                fill="currentColor"
                fillOpacity="0.6"
              >
                ${tickVal.toFixed(0)}
              </text>
            </g>
          ))}

          {/* price line */}
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground" />

          {/* event markers */}
          {eventMarkers.map((m, i) => {
            const color =
              m.ev.priority === "breaking"
                ? "var(--destructive)"
                : m.ev.priority === "notable"
                  ? "var(--primary)"
                  : "var(--muted-foreground)";
            return (
              <g key={i}>
                <line
                  x1={m.px}
                  x2={m.px}
                  y1={m.py}
                  y2={height - padding.bottom}
                  stroke={color}
                  strokeOpacity="0.25"
                  strokeWidth="1"
                />
                <a href={m.ev.url} target="_blank" rel="noopener noreferrer">
                  <circle cx={m.px} cy={m.py} r={4} fill={color} stroke="white" strokeWidth="1">
                    <title>
                      {new Date(m.ev.t).toLocaleDateString()} — {m.ev.title}
                    </title>
                  </circle>
                </a>
              </g>
            );
          })}

          {/* x-axis date labels */}
          <text
            x={padding.left}
            y={height - 6}
            fontSize="10"
            fill="currentColor"
            fillOpacity="0.6"
          >
            {new Date(xMin).toLocaleDateString()}
          </text>
          <text
            x={width - padding.right}
            y={height - 6}
            textAnchor="end"
            fontSize="10"
            fill="currentColor"
            fillOpacity="0.6"
          >
            {new Date(xMax).toLocaleDateString()}
          </text>
        </svg>
      </CardContent>
    </Card>
  );
}

function Legend() {
  return (
    <div className="hidden gap-3 text-[10px] uppercase tracking-wide text-muted-foreground sm:flex">
      <span className="flex items-center gap-1">
        <span className="inline-block size-2 rounded-full bg-destructive" /> Breaking
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-2 rounded-full bg-primary" /> Notable
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block size-2 rounded-full bg-muted-foreground" /> Other
      </span>
    </div>
  );
}
