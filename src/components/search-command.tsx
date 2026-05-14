"use client";

import * as React from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

type SearchHit = {
  id: number;
  title: string;
  url: string;
  source: string | null;
  oneLine: string | null;
  priority: string | null;
  publishedAt: string;
};

const DEBOUNCE_MS = 200;

export function SearchCommand() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Cmd-K / Ctrl-K
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch controller; cleanup runs from cleanup fn
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setHits([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Full-text search across all items">
      <CommandInput
        placeholder="Search items, sources, summaries…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && <div className="px-3 py-6 text-center text-xs text-muted-foreground">Searching…</div>}
        {!loading && query.trim() && hits.length === 0 && (
          <CommandEmpty>No results.</CommandEmpty>
        )}
        {!loading && !query.trim() && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            Type to search across feed, digests, official, competitors…
          </div>
        )}
        {hits.length > 0 && (
          <CommandGroup heading="Items">
            {hits.map((hit) => (
              <CommandItem
                key={hit.id}
                value={`${hit.id} ${hit.title}`}
                onSelect={() => {
                  setOpen(false);
                  window.open(hit.url, "_blank", "noopener,noreferrer");
                }}
              >
                <div className="flex w-full flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {hit.source && (
                      <Badge variant="outline" className="text-[10px]">
                        {hit.source}
                      </Badge>
                    )}
                    {hit.priority && (
                      <Badge
                        variant={
                          hit.priority === "breaking"
                            ? "destructive"
                            : hit.priority === "notable"
                              ? "default"
                              : "secondary"
                        }
                        className="text-[10px] uppercase tracking-wide"
                      >
                        {hit.priority}
                      </Badge>
                    )}
                    <span className="truncate text-sm text-foreground">{hit.title}</span>
                  </div>
                  {hit.oneLine && (
                    <span className="line-clamp-1 text-xs text-muted-foreground">{hit.oneLine}</span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
