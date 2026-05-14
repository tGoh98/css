import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ItemCard } from "@/components/item-card";
import {
  fetchWatchlistItems,
  listWatchlists,
  type WatchlistMatchConfig,
} from "@/lib/queries/watchlists";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const lists = await listWatchlists();

  const results = await Promise.all(
    lists.map(async (wl) => {
      const config = (wl.matchConfigJson ?? {}) as WatchlistMatchConfig;
      const items = await fetchWatchlistItems(config, 5);
      return { wl, items, config };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-xs text-muted-foreground">
          Saved filters for specific people, topics, and keywords
        </p>
      </div>

      {results.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No watchlists configured yet. Seed data will create some defaults
          (Dylan Field, exec team, AI features, acquisitions).
        </div>
      ) : (
        <ul className="flex flex-col gap-6">
          {results.map(({ wl, items, config }) => (
            <li key={wl.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{wl.name}</CardTitle>
                      <CardDescription>
                        <Badge variant="outline" className="mr-2 text-[10px] uppercase">
                          {wl.kind}
                        </Badge>
                        {config.keywords?.length
                          ? `keywords: ${config.keywords.join(", ")}`
                          : config.authors?.length
                            ? `authors: ${config.authors.join(", ")}`
                            : "no filter config"}
                      </CardDescription>
                    </div>
                    <Link
                      href={`/feed?q=${encodeURIComponent(
                        (config.keywords ?? []).join(" ") || wl.name,
                      )}`}
                      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      View all →
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="px-0">
                  <Separator />
                  {items.length === 0 ? (
                    <p className="px-6 py-4 text-sm text-muted-foreground">
                      No recent matches.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-3 px-3 py-4">
                      {items.map((fi) => (
                        <li key={fi.item.id}>
                          <ItemCard feedItem={fi} />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
