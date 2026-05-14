import { AnalystSummary } from "@/components/analyst-summary";
import { FigChart, type ChartEvent } from "@/components/fig-chart";
import { ItemCard } from "@/components/item-card";
import { Separator } from "@/components/ui/separator";
import { fetchFeed } from "@/lib/queries/items";
import { fetchYahooAnalyst, fetchYahooChart } from "@/lib/queries/yahoo";

export const dynamic = "force-dynamic";

export default async function AnalystPage() {
  const [chart, snapshot, analystItems] = await Promise.all([
    // 1 year of FIG closes — gives a better view of price-target evolution.
    fetchYahooChart("FIG", "1y", "1wk"),
    fetchYahooAnalyst("FIG"),
    // We don't have a canonical "analyst" source `kind`. Best-effort match by
    // either source.kind === 'analyst' OR source.name ILIKE '%analyst%' /
    // '%seeking%'. Done via the brand filter (case-insensitive substring).
    fetchFeed({ brand: "seeking" }, { limit: 30, groupByCluster: false }),
  ]);

  const events: ChartEvent[] = analystItems.map((fi) => ({
    t: fi.item.publishedAt.getTime(),
    title: fi.item.title,
    url: fi.item.url,
    priority: (fi.classification?.priority as ChartEvent["priority"]) ?? "routine",
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Analyst</h1>
        <p className="text-xs text-muted-foreground">
          Consensus ratings, price targets, and analyst coverage for FIG
        </p>
      </div>

      <AnalystSummary data={snapshot} />

      <FigChart data={chart} events={events} caption="1 year · weekly close" />

      <Separator />

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Coverage feed
        </h2>
        {analystItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No analyst items ingested yet (Seeking Alpha RSS, etc.).
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {analystItems.map((fi) => (
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
