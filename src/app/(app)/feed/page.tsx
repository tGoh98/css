import { FilterBar } from "@/components/filter-bar";
import { ItemCard } from "@/components/item-card";
import { SearchBar } from "@/components/search-bar";
import { fetchFeed, listSources } from "@/lib/queries/items";
import { periodToInterval } from "@/lib/relative-time";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  source?: string;
  priority?: string;
  period?: string;
  q?: string;
}>;

export default async function FeedPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const sourceId = sp.source ? Number(sp.source) : undefined;
  const priority =
    sp.priority === "routine" || sp.priority === "notable" || sp.priority === "breaking"
      ? sp.priority
      : undefined;
  const since = periodToInterval(sp.period ?? "all");
  const q = sp.q?.trim();

  const [feedItems, sources] = await Promise.all([
    fetchFeed(
      { sourceId, priority, since, q },
      { limit: 50, groupByCluster: true },
    ),
    listSources(),
  ]);

  return (
    <div>
      <SearchBar placeholder="Search the feed…" />

      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Feed</h1>
          <p className="text-xs text-muted-foreground">
            {feedItems.length} item{feedItems.length === 1 ? "" : "s"}
            {q ? ` · matching “${q}”` : ""}
          </p>
        </div>
      </div>

      <FilterBar
        sources={sources.map((s) => ({ value: String(s.id), label: s.name }))}
      />

      {feedItems.length === 0 ? (
        <EmptyState q={q} />
      ) : (
        <ul className="flex flex-col gap-3">
          {feedItems.map((fi) => (
            <li key={fi.item.id}>
              <ItemCard feedItem={fi} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ q }: { q?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {q ? <>No items match “{q}”. Try different terms.</> : <>No items yet — the ingest pipeline will fill this up shortly.</>}
    </div>
  );
}
