import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PriorityBadge } from "@/components/priority-badge";
import { fetchItemById } from "@/lib/queries/items";
import { renderMarkdown } from "@/lib/markdown";
import { relativeTime } from "@/lib/relative-time";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) notFound();

  const fi = await fetchItemById(itemId);
  if (!fi) notFound();
  const { item, classification, source } = fi;
  const isExternal = /^https?:\/\//i.test(item.url);

  // Items authored as Markdown (e.g. a comparative digest written from
  // /admin/upload-style flows) opt in via raw_json.render === "markdown".
  // Render them inline as HTML so headings/lists/bold actually display
  // instead of showing the raw markdown source.
  const renderAsMarkdown =
    (item.rawJson as { render?: string } | null)?.render === "markdown";

  return (
    <div className="flex flex-col gap-6">
      <Link href="/feed" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
        ← Back to feed
      </Link>

      <Card>
        <CardHeader>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {source && (
                <Badge variant="outline" className="text-[10px]">
                  {source.name}
                </Badge>
              )}
              <PriorityBadge priority={classification?.priority} />
              <span>{relativeTime(item.publishedAt)}</span>
              {item.author && <span>· {item.author}</span>}
            </div>
            <h1 className="text-lg font-semibold leading-snug">{item.title}</h1>
          </div>
        </CardHeader>
        <CardContent>
          {classification?.oneLine && (
            <p className="mb-3 rounded-md bg-muted/50 px-3 py-2 text-sm leading-relaxed">
              {classification.oneLine}
            </p>
          )}
          {item.snippet && !renderAsMarkdown && (
            <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{item.snippet}</p>
          )}
          {item.fullText && renderAsMarkdown ? (
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(item.fullText) }}
            />
          ) : item.fullText ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Show full text
              </summary>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                {item.fullText}
              </div>
            </details>
          ) : null}
          {isExternal && (
            <>
              <Separator className="my-4" />
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-foreground underline underline-offset-2"
              >
                Open original ↗
              </a>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
