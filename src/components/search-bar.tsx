"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Sticky in-page search bar (for Feed). Updates the `q` search param.
 * The page reads `searchParams.q` server-side to filter items.
 *
 * Cmd-K palette lives separately in `search-command.tsx`.
 */
export function SearchBar({ placeholder = "Search…" }: { placeholder?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [value, setValue] = React.useState(() => sp.get("q") ?? "");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function commit(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next) params.set("q", next);
    else params.delete("q");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), 250);
  }

  return (
    <div className="sticky top-0 z-30 -mx-6 mb-4 border-b border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="pl-9"
          type="search"
          aria-label="Search items"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] tracking-widest text-muted-foreground">
          ⌘K
        </span>
      </div>
    </div>
  );
}
