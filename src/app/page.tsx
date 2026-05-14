import Link from "next/link";
import { FigChart, type ChartEvent } from "@/components/fig-chart";
import { ItemCard } from "@/components/item-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchChart } from "@/lib/queries/chart";
import { fetchRecentDigestSet } from "@/lib/queries/digests";
import { fetchFeed, fetchTopRecentItems } from "@/lib/queries/items";

export const dynamic = "force-dynamic";

const PERIOD_LABEL: Record<string, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

/**
 * Pull the lede paragraph out of a digest's markdown summary. Strips headings
 * (Sonnet often opens with an H1), drops everything from "## " onwards, and
 * collapses the first 1–2 lines.
 */
function digestPreview(md: string | null, maxChars = 220): string {
  if (!md) return "";
  const noHeadings = md
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .join("\n");
  const firstSection = noHeadings.split(/\n\s*##\s/)[0] ?? noHeadings;
  const compact = firstSection.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return compact.slice(0, maxChars).trimEnd() + "…";
}

export default async function HomePage() {
  const [chart, eventItems, digests, topItems] = await Promise.all([
    fetchChart("FIG", "5y"),
    // Reuses Official's event-marker pool; cheap enough that we don't need
    // a dedicated server cache.
    fetchFeed({ kinds: ["sec", "blog"] }, { limit: 1000, groupByCluster: false }),
    fetchRecentDigestSet(),
    fetchTopRecentItems({ hours: 48, limit: 10 }),
  ]);

  const chartEvents: ChartEvent[] = eventItems.map((fi) => ({
    t: fi.item.publishedAt.getTime(),
    title: fi.item.title,
    url: fi.item.url,
    priority: (fi.classification?.priority as ChartEvent["priority"]) ?? "routine",
    source: fi.source?.name ?? null,
    oneLine: fi.classification?.oneLine ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Home</h1>
        <p className="text-xs text-muted-foreground">
          FIG ticker, latest digests, and what just broke
        </p>
      </div>

      <FigChart data={chart} events={chartEvents} caption="Daily close" defaultRange="1M" />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Recent digests */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent digests</CardTitle>
            <CardDescription className="text-xs">
              Latest daily / weekly / monthly digest at a glance
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {digests.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                No digests yet. Daily digests fire from the owner&apos;s Mac at 09:00.
              </div>
            ) : (
              digests.map((d) => {
                const start = d.periodStart.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });
                return (
                  <Link
                    key={d.id}
                    href={`/digests/${d.id}`}
                    className="group block rounded-md border border-border p-3 transition-colors hover:border-foreground/40"
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">
                        {PERIOD_LABEL[d.period] ?? d.period} digest
                      </span>
                      <span className="text-[10px] text-muted-foreground">{start}</span>
                    </div>
                    <p className="line-clamp-3 text-xs text-muted-foreground">
                      {digestPreview(d.summaryMd) || "(no summary yet)"}
                    </p>
                  </Link>
                );
              })
            )}
            <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
              <Link href="/digests" prefetch={false}>
                All digests →
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Top items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top items</CardTitle>
            <CardDescription className="text-xs">
              Last 48 hours · breaking & notable, falling back to recent items on a quiet day
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {topItems.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                No classified items yet.
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {topItems.map((fi) => (
                  <li key={fi.item.id}>
                    <ItemCard feedItem={fi} />
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
              <Link href="/feed" prefetch={false}>
                Full feed →
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
