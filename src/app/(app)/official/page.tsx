import { FigChart, type ChartEvent } from "@/components/fig-chart";
import { InsiderActivity } from "@/components/insider-activity";
import { ItemCard } from "@/components/item-card";
import { Separator } from "@/components/ui/separator";
import { fetchFeed } from "@/lib/queries/items";
import { fetchRecentInsiderActivity } from "@/lib/queries/insider";
import { fetchYahooChart } from "@/lib/queries/yahoo";

export const dynamic = "force-dynamic";

export default async function OfficialPage() {
  // Pull in parallel — chart, insider data, and the recent SEC+blog feed.
  const [chart, insider, feedItems] = await Promise.all([
    fetchYahooChart("FIG", "3mo", "1d"),
    fetchRecentInsiderActivity(10),
    fetchFeed({ kinds: ["sec", "blog"] }, { limit: 30, groupByCluster: false }),
  ]);

  // Build event markers for the chart from items within the chart's date range.
  // Use the feed we already have — it's pre-filtered to sec+blog kinds.
  const chartEvents: ChartEvent[] = feedItems.map((fi) => ({
    t: fi.item.publishedAt.getTime(),
    title: fi.item.title,
    url: fi.item.url,
    priority: (fi.classification?.priority as ChartEvent["priority"]) ?? "routine",
  }));

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
        </h2>
        {feedItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No SEC filings or blog posts ingested yet.
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
    </div>
  );
}
