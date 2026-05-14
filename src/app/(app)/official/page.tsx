import Link from "next/link";
import { FigChart, type ChartEvent } from "@/components/fig-chart";
import { InsiderActivity } from "@/components/insider-activity";
import { ItemCard } from "@/components/item-card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { fetchFeed } from "@/lib/queries/items";
import { fetchRecentInsiderActivity } from "@/lib/queries/insider";
import { fetchChart } from "@/lib/queries/chart";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type SearchParams = Promise<{ page?: string }>;

export default async function OfficialPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [chart, insider, feedItems, eventItems] = await Promise.all([
    fetchChart("FIG", "3mo"),
    fetchRecentInsiderActivity(10),
    fetchFeed(
      { kinds: ["sec", "blog"] },
      { limit: PAGE_SIZE + 1, offset, groupByCluster: false },
    ),
    // Separate pull for the chart event markers — always last 90 days,
    // regardless of which page the user is on.
    fetchFeed(
      { kinds: ["sec", "blog"] },
      { limit: 200, groupByCluster: false },
    ),
  ]);

  const hasNext = feedItems.length > PAGE_SIZE;
  const visible = hasNext ? feedItems.slice(0, PAGE_SIZE) : feedItems;

  const chartEvents: ChartEvent[] = eventItems.map((fi) => ({
    t: fi.item.publishedAt.getTime(),
    title: fi.item.title,
    url: fi.item.url,
    priority: (fi.classification?.priority as ChartEvent["priority"]) ?? "routine",
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

      <FigChart data={chart} events={chartEvents} caption="3 months · daily close" />

      <InsiderActivity rows={insider} />

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
