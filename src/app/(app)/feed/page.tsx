import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { ItemCard } from "@/components/item-card";
import { SearchBar } from "@/components/search-bar";
import { Button } from "@/components/ui/button";
import { fetchFeed, listSources } from "@/lib/queries/items";
import { periodToInterval } from "@/lib/relative-time";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = Promise<{
  source?: string;
  priority?: string;
  period?: string;
  q?: string;
  page?: string;
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
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [feedItems, sources] = await Promise.all([
    fetchFeed(
      // Hide routine competitor chatter from the main Feed — Figma signal first.
      { sourceId, priority, since, q, competitorPriorityFloor: "notable" },
      { limit: PAGE_SIZE + 1, offset, groupByCluster: true },
    ),
    listSources(),
  ]);

  const hasNext = feedItems.length > PAGE_SIZE;
  const visible = hasNext ? feedItems.slice(0, PAGE_SIZE) : feedItems;

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (sp.source) params.set("source", sp.source);
    if (sp.priority) params.set("priority", sp.priority);
    if (sp.period) params.set("period", sp.period);
    if (sp.q) params.set("q", sp.q);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/feed?${qs}` : "/feed";
  }

  return (
    <div>
      <SearchBar placeholder="Search the feed…" />

      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Feed</h1>
          <p className="text-xs text-muted-foreground">
            {visible.length} item{visible.length === 1 ? "" : "s"}
            {q ? ` · matching “${q}”` : ""}
            {page > 1 ? ` · page ${page}` : ""}
          </p>
        </div>
      </div>

      <FilterBar
        sources={sources.map((s) => ({ value: String(s.id), label: s.name }))}
      />

      {visible.length === 0 ? (
        <EmptyState q={q} page={page} />
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((fi) => (
            <li key={fi.item.id}>
              <ItemCard feedItem={fi} />
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || hasNext) && (
        <nav
          aria-label="Feed pagination"
          className="mt-8 flex items-center justify-between border-t border-border pt-4"
        >
          <Button
            asChild
            variant="outline"
            size="sm"
            disabled={page <= 1}
            aria-disabled={page <= 1}
          >
            {page > 1 ? (
              <Link href={pageHref(page - 1)} prefetch={false}>
                ← Previous
              </Link>
            ) : (
              <span aria-disabled className="opacity-50">← Previous</span>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <Button
            asChild
            variant="outline"
            size="sm"
            disabled={!hasNext}
            aria-disabled={!hasNext}
          >
            {hasNext ? (
              <Link href={pageHref(page + 1)} prefetch={false}>
                Next →
              </Link>
            ) : (
              <span aria-disabled className="opacity-50">Next →</span>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}

function EmptyState({ q, page }: { q?: string; page: number }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {q ? (
        <>No items match “{q}”. Try different terms.</>
      ) : page > 1 ? (
        <>
          No more items on page {page}. <Link href="/feed" className="underline">Back to page 1</Link>.
        </>
      ) : (
        <>No items yet — the ingest pipeline will fill this up shortly.</>
      )}
    </div>
  );
}
