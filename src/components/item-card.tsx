import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PriorityBadge } from "@/components/priority-badge";
import { relativeTime } from "@/lib/relative-time";
import type { FeedItem } from "@/lib/queries/items";

export function ItemCard({ feedItem }: { feedItem: FeedItem }) {
  const { item, classification, source, cluster, clusterCount } = feedItem;
  const showClusterBadge = (clusterCount ?? 0) > 1;
  // Manual uploads use a `upload:<sha256>` placeholder URL — no external
  // page to open. Render the title as plain text and hide "Open original".
  const isExternal = /^https?:\/\//i.test(item.url);
  const displayTitle =
    cluster?.representativeTitle && showClusterBadge
      ? cluster.representativeTitle
      : item.title;
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {source ? (
              <Badge variant="outline" className="rounded-md text-[10px] font-medium">
                {source.name}
              </Badge>
            ) : null}
            <PriorityBadge priority={classification?.priority} />
            <span title={item.publishedAt.toString()}>
              {relativeTime(item.publishedAt)}
            </span>
            {item.author ? <span>· {item.author}</span> : null}
            {showClusterBadge && item.clusterId ? (
              <Link href={`/cluster/${item.clusterId}`} className="hover:opacity-80">
                <Badge
                  variant="ghost"
                  className="cursor-pointer text-[10px] hover:underline"
                >
                  +{(clusterCount ?? 1) - 1} similar
                </Badge>
              </Link>
            ) : null}
          </div>
          {isExternal ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm font-semibold leading-snug text-foreground hover:underline"
            >
              {displayTitle}
            </a>
          ) : (
            <Link
              href={`/item/${item.id}`}
              className="block text-sm font-semibold leading-snug text-foreground hover:underline"
            >
              {displayTitle}
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4">
        {classification?.oneLine ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {classification.oneLine}
          </p>
        ) : item.snippet ? (
          <p className="text-sm leading-relaxed text-muted-foreground line-clamp-3">
            {item.snippet}
          </p>
        ) : null}
        <div className="mt-3 flex items-center gap-3 text-xs">
          <Link
            href={`/item/${item.id}`}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            Details
          </Link>
          {isExternal && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              Open original ↗
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
