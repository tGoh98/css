import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchDigestById } from "@/lib/queries/digests";
import { fetchItemById } from "@/lib/queries/items";
import { renderMarkdown } from "@/lib/markdown";
import { relativeTime } from "@/lib/relative-time";

export const dynamic = "force-dynamic";

const PERIOD_LABEL: Record<string, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  event: "Event",
};

export default async function DigestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const digestId = Number(id);
  if (!Number.isInteger(digestId) || digestId <= 0) notFound();

  const digest = await fetchDigestById(digestId);
  if (!digest) notFound();

  // Resolve linked source items so we can render a "Sources" footer with
  // titles, not just numeric ids. Cap at 50 lookups so a huge event-digest
  // doesn't fan out unboundedly.
  const sourceItems = await Promise.all(
    digest.itemIds.slice(0, 50).map((iid) => fetchItemById(iid)),
  );

  const periodLabel = PERIOD_LABEL[digest.period] ?? digest.period;
  const startStr = digest.periodStart.toLocaleDateString();
  const endStr = digest.periodEnd.toLocaleDateString();
  const rangeLabel = startStr === endStr ? startStr : `${startStr} → ${endStr}`;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/digests"
        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        ← Back to digests
      </Link>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base">
                {periodLabel} digest · {rangeLabel}
              </CardTitle>
              <CardDescription>
                {relativeTime(digest.generatedAt)} · {digest.itemIds.length} items
                {digest.model ? ` · ${digest.model}` : ""}
              </CardDescription>
            </div>
            <Badge variant="outline">{digest.period}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {digest.summaryMd ? (
            <div
              className="prose-css text-foreground"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(digest.summaryMd) }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Digest queued — summary will appear once the worker has run.
            </p>
          )}

          {sourceItems.some((s) => s !== null) && (
            <div className="mt-8 border-t border-border pt-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sources ({digest.itemIds.length})
              </h2>
              <ul className="flex flex-col gap-1.5 text-xs">
                {sourceItems.map((s, idx) => {
                  const iid = digest.itemIds[idx];
                  if (!s) {
                    return (
                      <li key={iid} className="text-muted-foreground">
                        <span className="font-mono">#{iid}</span> · (deleted or unavailable)
                      </li>
                    );
                  }
                  return (
                    <li key={iid}>
                      <Link
                        href={`/item/${iid}`}
                        className="text-foreground hover:underline"
                      >
                        {s.item.title}
                      </Link>
                      {s.source && (
                        <span className="text-muted-foreground"> · {s.source.name}</span>
                      )}
                    </li>
                  );
                })}
                {digest.itemIds.length > sourceItems.length && (
                  <li className="text-muted-foreground">
                    … and {digest.itemIds.length - sourceItems.length} more (truncated)
                  </li>
                )}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
