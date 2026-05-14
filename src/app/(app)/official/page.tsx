import Link from "next/link";
import { FigChart, type ChartEvent } from "@/components/fig-chart";
import { InsiderActivity } from "@/components/insider-activity";
import { parseCount, sinceToDate } from "@/components/insider-filters-shared";
import { ItemCard } from "@/components/item-card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { fetchFeed } from "@/lib/queries/items";
import {
  countInsiderActivity,
  fetchInsiderActivity,
  fetchInsiderReporters,
} from "@/lib/queries/insider";
import { fetchChart } from "@/lib/queries/chart";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type SearchParams = Promise<{
  page?: string;
  since?: string;
  who?: string;
  n?: string;
}>;

export default async function OfficialPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const insiderFilter = {
    since: sinceToDate(sp.since),
    reporter: sp.who?.trim() || null,
    limit: parseCount(sp.n),
  };
  const hasActiveFilter = Boolean(insiderFilter.since || insiderFilter.reporter || sp.n);

  const [chart, insider, insiderTotal, reporters, feedItems, eventItems] = await Promise.all([
    // Fetch the widest range we offer; FigChart slices on the client when
    // the user switches range tabs, so this is one trip per page load.
    fetchChart("FIG", "5y"),
    fetchInsiderActivity(insiderFilter),
    countInsiderActivity({ since: insiderFilter.since, reporter: insiderFilter.reporter }),
    fetchInsiderReporters(),
    fetchFeed(
      { kinds: ["sec", "blog"] },
      { limit: PAGE_SIZE + 1, offset, groupByCluster: false },
    ),
    // Event-marker pool — pulled once at the widest window so range tabs can
    // filter client-side without re-fetching.
    fetchFeed(
      { kinds: ["sec", "blog"] },
      { limit: 1000, groupByCluster: false },
    ),
  ]);

  const hasNext = feedItems.length > PAGE_SIZE;
  const visible = hasNext ? feedItems.slice(0, PAGE_SIZE) : feedItems;

  const chartEvents: ChartEvent[] = eventItems.map((fi) => ({
    t: fi.item.publishedAt.getTime(),
    title: fi.item.title,
    url: fi.item.url,
    priority: (fi.classification?.priority as ChartEvent["priority"]) ?? "routine",
    source: fi.source?.name ?? null,
    oneLine: fi.classification?.oneLine ?? null,
  }));

  function pageHref(targetPage: number): string {
    return targetPage > 1 ? `/official?page=${targetPage}` : "/official";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Official</h1>
        <p className="text-xs text-muted-foreground">
          SEC filings + Figma&apos;s blog/press releases · FIG ticker overlay
        </p>
      </div>

      <FigChart data={chart} events={chartEvents} caption="Daily close" />

      <InsiderActivity
        rows={insider}
        total={insiderTotal}
        reporters={reporters}
        hasActiveFilter={hasActiveFilter}
      />

      <Separator />

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent filings & posts
          {page > 1 ? <span className="ml-2 font-normal text-muted-foreground/60">· page {page}</span> : null}
        </h2>
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {page > 1 ? (
              <>No more items on page {page}. <Link href="/official" className="underline">Back to page 1</Link>.</>
            ) : (
              <>No SEC filings or blog posts ingested yet.</>
            )}
          </div>
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
            aria-label="Official pagination"
            className="mt-8 flex items-center justify-between border-t border-border pt-4"
          >
            <Button asChild variant="outline" size="sm" disabled={page <= 1} aria-disabled={page <= 1}>
              {page > 1 ? (
                <Link href={pageHref(page - 1)} prefetch={false}>← Previous</Link>
              ) : (
                <span aria-disabled className="opacity-50">← Previous</span>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">Page {page}</span>
            <Button asChild variant="outline" size="sm" disabled={!hasNext} aria-disabled={!hasNext}>
              {hasNext ? (
                <Link href={pageHref(page + 1)} prefetch={false}>Next →</Link>
              ) : (
                <span aria-disabled className="opacity-50">Next →</span>
              )}
            </Button>
          </nav>
        )}
      </div>
    </div>
  );
}
