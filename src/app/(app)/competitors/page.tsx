import { FilterBar } from "@/components/filter-bar";
import { ItemCard } from "@/components/item-card";
import { SearchBar } from "@/components/search-bar";
import { fetchFeed, listSources } from "@/lib/queries/items";
import { periodToInterval } from "@/lib/relative-time";

export const dynamic = "force-dynamic";

const BRANDS = ["Adobe", "Canva", "Sketch", "Penpot"] as const;

type SearchParams = Promise<{
  source?: string;
  priority?: string;
  period?: string;
  brand?: string;
  q?: string;
}>;

export default async function CompetitorsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const sourceId = sp.source ? Number(sp.source) : undefined;
  const priority =
    sp.priority === "routine" || sp.priority === "notable" || sp.priority === "breaking"
      ? sp.priority
      : undefined;
  const since = periodToInterval(sp.period ?? "all");
  const brand = sp.brand && BRANDS.includes(sp.brand as (typeof BRANDS)[number]) ? sp.brand : undefined;
  const q = sp.q?.trim();

  const [feedItems, sources] = await Promise.all([
    fetchFeed(
      { sourceId, priority, since, brand, q, category: "competitor" },
      { limit: 50, groupByCluster: true },
    ),
    listSources(),
  ]);

  // Only show competitor sources in the source dropdown
  const competitorSources = sources.filter((s) => s.category === "competitor");

  return (
    <div>
      <SearchBar placeholder="Search competitor news…" />
      <div className="mb-3">
        <h1 className="text-xl font-semibold tracking-tight">Competitors</h1>
        <p className="text-xs text-muted-foreground">Adobe · Canva · Sketch · Penpot</p>
      </div>

      <FilterBar
        sources={competitorSources.map((s) => ({ value: String(s.id), label: s.name }))}
        extra={[
          {
            key: "brand",
            label: "Brand",
            options: [
              { value: "", label: "All brands" },
              ...BRANDS.map((b) => ({ value: b, label: b })),
            ],
          },
        ]}
      />

      {feedItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No competitor items yet.
        </div>
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
