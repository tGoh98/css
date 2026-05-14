import { ItemCard } from "@/components/item-card";
import { fetchFeed } from "@/lib/queries/items";

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const feedItems = await fetchFeed(
    { onlyBookmarked: true },
    { limit: 100, groupByCluster: false },
  );

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Saved</h1>
        <p className="text-xs text-muted-foreground">
          {feedItems.length} bookmarked item{feedItems.length === 1 ? "" : "s"}
        </p>
      </div>

      {feedItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Nothing saved yet. Use the bookmark icon on any item to save it here.
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
