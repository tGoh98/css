"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export const SINCE_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "6mo", label: "Last 6 months" },
  { value: "1y", label: "Last 1 year" },
] as const;

export const COUNT_OPTIONS = [
  { value: "10", label: "10" },
  { value: "25", label: "25" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
] as const;

export type SinceValue = (typeof SINCE_OPTIONS)[number]["value"];
export type CountValue = (typeof COUNT_OPTIONS)[number]["value"];

const PARAM_SINCE = "since";
const PARAM_WHO = "who";
const PARAM_N = "n";

/** Map a since-preset to a Date cutoff, or null for "all time". */
export function sinceToDate(v: string | undefined | null): Date | null {
  const now = Date.now();
  switch (v) {
    case "30d":
      return new Date(now - 30 * 86_400_000);
    case "90d":
      return new Date(now - 90 * 86_400_000);
    case "6mo":
      return new Date(now - 182 * 86_400_000);
    case "1y":
      return new Date(now - 365 * 86_400_000);
    default:
      return null;
  }
}

export function parseCount(v: string | undefined | null): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 10;
  if (!COUNT_OPTIONS.some((o) => Number(o.value) === n)) return 10;
  return n;
}

const selectCls =
  "h-9 sm:h-7 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function InsiderFilters({
  reporters,
  hasActiveFilter,
}: {
  reporters: string[];
  hasActiveFilter: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const since = sp.get(PARAM_SINCE) ?? "all";
  const who = sp.get(PARAM_WHO) ?? "";
  const n = sp.get(PARAM_N) ?? "10";

  function setParam(key: string, value: string, defaultValue: string) {
    const params = new URLSearchParams(sp.toString());
    if (value && value !== defaultValue) params.set(key, value);
    else params.delete(key);
    // Filters live alongside /official's `page` param; the feed pagination
    // should reset when filters change, but the table beneath it is a
    // different concern from this card. Keep them independent: don't touch
    // `page` here.
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function reset() {
    const params = new URLSearchParams(sp.toString());
    params.delete(PARAM_SINCE);
    params.delete(PARAM_WHO);
    params.delete(PARAM_N);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1.5 text-muted-foreground">
        <span className="hidden sm:inline">Range:</span>
        <select
          value={since}
          onChange={(e) => setParam(PARAM_SINCE, e.target.value, "all")}
          className={cn(selectCls)}
          aria-label="Time range"
        >
          {SINCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-muted-foreground">
        <span className="hidden sm:inline">Person:</span>
        <select
          value={who}
          onChange={(e) => setParam(PARAM_WHO, e.target.value, "")}
          className={cn(selectCls, "max-w-[180px]")}
          aria-label="Reporter"
        >
          <option value="">All people</option>
          {reporters.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-muted-foreground">
        <span className="hidden sm:inline">Show:</span>
        <select
          value={n}
          onChange={(e) => setParam(PARAM_N, e.target.value, "10")}
          className={cn(selectCls)}
          aria-label="Number of entries"
        >
          {COUNT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {hasActiveFilter && (
        <button
          type="button"
          onClick={reset}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Reset
        </button>
      )}
    </div>
  );
}
