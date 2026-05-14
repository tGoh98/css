/**
 * Shared options + pure helpers for the insider activity filter. Lives in a
 * server-safe module so both the client `<InsiderFilters>` component and the
 * server `/official` page can import from it. Putting these in the
 * `"use client"` file would mark them as client references — and the server
 * page calls `sinceToDate` / `parseCount` directly, which fails with
 * "Attempted to call X from the server."
 */

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
