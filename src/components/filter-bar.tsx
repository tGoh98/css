"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

type FilterDef = {
  key: string;
  label: string;
  options: Option[];
};

const PRIORITY_OPTIONS: Option[] = [
  { value: "", label: "All priorities" },
  { value: "breaking", label: "Breaking" },
  { value: "notable", label: "Notable" },
  { value: "routine", label: "Routine" },
];

const PERIOD_OPTIONS: Option[] = [
  { value: "all", label: "All time" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

export function FilterBar({
  sources,
  showSource = true,
  showPriority = true,
  showPeriod = true,
  extra,
}: {
  sources?: Option[];
  showSource?: boolean;
  showPriority?: boolean;
  showPeriod?: boolean;
  extra?: FilterDef[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const filters: FilterDef[] = [];
  if (showSource && sources)
    filters.push({
      key: "source",
      label: "Source",
      options: [{ value: "", label: "All sources" }, ...sources],
    });
  if (showPriority) filters.push({ key: "priority", label: "Priority", options: PRIORITY_OPTIONS });
  if (showPeriod) filters.push({ key: "period", label: "Period", options: PERIOD_OPTIONS });
  if (extra) filters.push(...extra);

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      {filters.map((f) => {
        const current = sp.get(f.key) ?? "";
        return (
          <label key={f.key} className="flex items-center gap-1.5 text-muted-foreground">
            <span className="hidden sm:inline">{f.label}:</span>
            <select
              value={current}
              onChange={(e) => setParam(f.key, e.target.value)}
              className={cn(
                "h-7 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
