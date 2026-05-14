import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/filter-bar";
import { listDigests } from "@/lib/queries/digests";
import { renderMarkdown } from "@/lib/markdown";
import { relativeTime } from "@/lib/relative-time";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

type SearchParams = Promise<{ period?: string; page?: string }>;

const PERIOD_LABEL: Record<string, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

export default async function DigestsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const period =
    sp.period === "day" || sp.period === "week" || sp.period === "month" ? sp.period : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Over-fetch by one to detect "has next" without a count query.
  const rows = await listDigests(period, PAGE_SIZE + 1, offset);
  const hasNext = rows.length > PAGE_SIZE;
  const visible = hasNext ? rows.slice(0, PAGE_SIZE) : rows;

  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (sp.period) params.set("period", sp.period);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/digests?${qs}` : "/digests";
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Digests</h1>
          <p className="text-xs text-muted-foreground">
            Scheduled AI summaries — daily, weekly, monthly · sorted newest first
            {page > 1 ? ` · page ${page}` : ""}
          </p>
        </div>
      </div>

      <FilterBar
        showSource={false}
        showPriority={false}
        showPeriod={false}
        extra={[
          {
            key: "period",
            label: "Period",
            options: [
              { value: "", label: "All periods" },
              { value: "day", label: "Daily" },
              { value: "week", label: "Weekly" },
              { value: "month", label: "Monthly" },
            ],
          },
        ]}
      />

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {page > 1 ? (
            <>
              No more digests on page {page}.{" "}
              <Link href="/digests" className="underline">
                Back to page 1
              </Link>
              .
            </>
          ) : (
            <>No digests yet. The local digest worker runs daily at 09:00 (catch-up on next wake).</>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {visible.map((d) => (
            <li key={d.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        {PERIOD_LABEL[d.period] ?? d.period} digest ·{" "}
                        {d.periodStart.toLocaleDateString()} → {d.periodEnd.toLocaleDateString()}
                      </CardTitle>
                      <CardDescription>
                        {relativeTime(d.generatedAt)} · {d.itemIds.length} items
                        {d.model ? ` · ${d.model}` : ""}
                      </CardDescription>
                    </div>
                    <Badge variant="outline">{d.period}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {d.summaryMd ? (
                    <div
                      className="prose-css text-foreground"
                      // Safe-HTML renderer: only emits <h1-3>, <p>, <ul>, <li>, <strong>, <a>, <code>.
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(d.summaryMd) }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Digest queued — summary will appear once the worker has run.
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || hasNext) && (
        <nav
          aria-label="Digests pagination"
          className="mt-8 flex items-center justify-between border-t border-border pt-4"
        >
          <Button asChild variant="outline" size="sm" disabled={page <= 1} aria-disabled={page <= 1}>
            {page > 1 ? (
              <Link href={pageHref(page - 1)} prefetch={false}>
                ← Previous
              </Link>
            ) : (
              <span aria-disabled className="opacity-50">
                ← Previous
              </span>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <Button asChild variant="outline" size="sm" disabled={!hasNext} aria-disabled={!hasNext}>
            {hasNext ? (
              <Link href={pageHref(page + 1)} prefetch={false}>
                Next →
              </Link>
            ) : (
              <span aria-disabled className="opacity-50">
                Next →
              </span>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}
