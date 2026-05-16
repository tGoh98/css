import { notFound } from "next/navigation";
import Link from "next/link";
import { ItemCard } from "@/components/item-card";
import { fetchClusterById } from "@/lib/queries/items";

export const dynamic = "force-dynamic";

export default async function ClusterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const clusterId = Number(id);
  if (!Number.isInteger(clusterId) || clusterId <= 0) notFound();

  const result = await fetchClusterById(clusterId);
  if (!result) notFound();
  const { cluster, items } = result;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/feed"
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        ← Back to feed
      </Link>

      <div>
        <h1 className="text-lg font-semibold leading-snug">
          {cluster.representativeTitle}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? "item" : "items"} covering this story
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {items.map((fi) => (
          <ItemCard key={fi.item.id} feedItem={fi} />
        ))}
      </div>
    </div>
  );
}
