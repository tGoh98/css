"use client";

import { useMemo, useState } from "react";
import type { ChartData } from "@/lib/queries/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ChartEvent = {
  /** ms-since-epoch. */
  t: number;
  title: string;
  url: string;
  priority?: "routine" | "notable" | "breaking" | null;
  source?: string | null;
  oneLine?: string | null;
};

type RangeKey = "1W" | "1M" | "6M" | "1Y" | "5Y";
const RANGES: { key: RangeKey; days: number; label: string }[] = [
  { key: "1W", days: 7, label: "1W" },
  { key: "1M", days: 31, label: "1M" },
  { key: "6M", days: 183, label: "6M" },
  { key: "1Y", days: 366, label: "1Y" },
  { key: "5Y", days: 1830, label: "5Y" },
];

/**
 * Client-rendered SVG line chart for FIG with range selector + event markers
 * + rich hover tooltips. Daily-close data is passed in once (a year or more);
 * range tabs slice it on the client so switching is instant.
 */
export function FigChart({
  data,
  events = [],
  height = 260,
  caption,
  defaultRange = "1M",
}: {
  data: ChartData | null;
  events?: ChartEvent[];
  height?: number;
  caption?: string;
  defaultRange?: RangeKey;
}) {
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const sliced = useMemo(() => {
    if (!data || data.points.length === 0) return null;
    const days = RANGES.find((r) => r.key === range)?.days ?? 31;
    const lastT = data.points[data.points.length - 1].t;
    const since = lastT - days * 24 * 60 * 60 * 1000;
    const pts = data.points.filter((p) => p.t >= since);
    const evs = events.filter((e) => e.t >= since && e.t <= lastT);
    return { points: pts, events: evs };
  }, [data, events, range]);

  if (!data || !sliced || sliced.points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <CardTitle>FIG</CardTitle>
              <CardDescription>{caption ?? "Chart unavailable"}</CardDescription>
            </div>
            <RangeTabs range={range} setRange={setRange} />
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No chart data for this range — try a wider window, or wait for the next hourly ingest.
        </CardContent>
      </Card>
    );
  }

  const width = 900;
  const padding = { top: 16, right: 16, bottom: 24, left: 44 };

  const points = sliced.points;
  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.c);
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

  // For ranges with a single point ("1D" on daily-close data), draw a marker
  // instead of a line — a single-point <path> is invisible.
  const singlePoint = points.length < 2;
  const path = singlePoint
    ? ""
    : points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.c).toFixed(1)}`)
        .join(" ");

  const eventMarkers = sliced.events.map((ev) => {
    let best = points[0];
    let bestDist = Math.abs(best.t - ev.t);
    for (const p of points) {
      const d = Math.abs(p.t - ev.t);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return { ev, px: x(ev.t), py: y(best.c) };
  });

  const last = points[points.length - 1];
  const first = points[0];
  const change = last.c - first.c;
  const changePct = (change / first.c) * 100;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => yLo + p * (yHi - yLo));

  // Disclaimer: when the chart was last polled.
  const polledAt = data.fetchedAt ? new Date(data.fetchedAt) : null;
  const polledRel = polledAt ? relativeMinutes(polledAt) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <CardTitle className="text-base">FIG · ${last.c.toFixed(2)}</CardTitle>
            <CardDescription>
              <span className={change >= 0 ? "text-emerald-600" : "text-destructive"}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)} ({changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%)
              </span>{" "}
              · {range} · {caption ?? "Daily close"}
            </CardDescription>
          </div>
          <RangeTabs range={range} setRange={setRange} />
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full text-muted-foreground"
          role="img"
          aria-label={`FIG ${range} chart`}
          onMouseLeave={() => setHoveredIdx(null)}
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

          {/* price line (or sole marker for single-point ranges) */}
          {singlePoint ? (
            <circle
              cx={x(points[0].t)}
              cy={y(points[0].c)}
              r={3}
              className="fill-foreground"
            />
          ) : (
            <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground" />
          )}

          {/* event markers */}
          {eventMarkers.map((m, i) => {
            const color =
              m.ev.priority === "breaking"
                ? "var(--destructive)"
                : m.ev.priority === "notable"
                  ? "var(--primary)"
                  : "var(--muted-foreground)";
            const isHovered = hoveredIdx === i;
            return (
              <g
                key={i}
                onMouseEnter={() => setHoveredIdx(i)}
                style={{ cursor: "pointer" }}
              >
                <line
                  x1={m.px}
                  x2={m.px}
                  y1={m.py}
                  y2={height - padding.bottom}
                  stroke={color}
                  strokeOpacity={isHovered ? 0.55 : 0.25}
                  strokeWidth="1"
                />
                <a href={m.ev.url} target="_blank" rel="noopener noreferrer">
                  <circle
                    cx={m.px}
                    cy={m.py}
                    r={isHovered ? 6 : 4}
                    fill={color}
                    stroke="white"
                    strokeWidth="1"
                  />
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

          {/* hover tooltip — rendered LAST so it sits above the markers */}
          {hoveredIdx !== null && eventMarkers[hoveredIdx] && (
            <EventTooltip
              marker={eventMarkers[hoveredIdx]}
              chartWidth={width}
              chartHeight={height}
            />
          )}
        </svg>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground/80">
          <span>
            Not live · daily close, polled hourly from Yahoo Finance
            {polledRel ? ` · last refresh ${polledRel}` : ""}
          </span>
          <Legend />
        </div>
      </CardContent>
    </Card>
  );
}

function EventTooltip({
  marker,
  chartWidth,
  chartHeight,
}: {
  marker: { ev: ChartEvent; px: number; py: number };
  chartWidth: number;
  chartHeight: number;
}) {
  const { ev, px, py } = marker;
  const tw = 300;
  const th = ev.oneLine ? 110 : 78;
  // Default: tooltip to the right of and above the marker. Flip if off-canvas.
  let tx = px + 12;
  let ty = py - th - 8;
  if (tx + tw > chartWidth - 4) tx = px - tw - 12;
  if (tx < 4) tx = 4;
  if (ty < 4) ty = py + 14;
  if (ty + th > chartHeight - 4) ty = chartHeight - th - 4;

  const priorityBadge =
    ev.priority === "breaking"
      ? { text: "Breaking", cls: "bg-destructive text-destructive-foreground" }
      : ev.priority === "notable"
        ? { text: "Notable", cls: "bg-primary text-primary-foreground" }
        : ev.priority === "routine"
          ? { text: "Routine", cls: "bg-muted text-muted-foreground" }
          : null;

  return (
    <foreignObject
      x={tx}
      y={ty}
      width={tw}
      height={th}
      style={{ pointerEvents: "none", overflow: "visible" }}
    >
      <div
        className="rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-3 text-xs leading-snug"
        style={{ width: tw }}
      >
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide">
          <span className="text-muted-foreground">
            {new Date(ev.t).toLocaleDateString()}
          </span>
          {ev.source ? (
            <span className="text-muted-foreground">· {ev.source}</span>
          ) : null}
          {priorityBadge ? (
            <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium", priorityBadge.cls)}>
              {priorityBadge.text}
            </span>
          ) : null}
        </div>
        <div className="line-clamp-2 font-medium text-foreground">{ev.title}</div>
        {ev.oneLine ? (
          <div className="mt-1 line-clamp-2 text-muted-foreground">{ev.oneLine}</div>
        ) : null}
      </div>
    </foreignObject>
  );
}

function RangeTabs({
  range,
  setRange,
}: {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5 text-[11px]">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => setRange(r.key)}
          className={cn(
            "rounded px-2 py-0.5 font-medium transition-colors",
            range === r.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={range === r.key}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="hidden gap-3 text-[10px] uppercase tracking-wide sm:flex">
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

function relativeMinutes(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
