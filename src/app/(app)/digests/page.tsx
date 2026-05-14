import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/filter-bar";
import { listDigests } from "@/lib/queries/digests";
import { renderMarkdown } from "@/lib/markdown";
import { relativeTime } from "@/lib/relative-time";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ period?: string }>;

const PERIOD_LABEL: Record<string, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

export default async function DigestsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const period =
    sp.period === "day" || sp.period === "week" || sp.period === "month" ? sp.period : undefined;

  const rows = await listDigests(period, 30);

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Digests</h1>
          <p className="text-xs text-muted-foreground">
            Scheduled AI summaries — daily, weekly, monthly
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

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No digests yet. The local digest worker runs daily at 09:00 (catch-up on next wake).
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((d) => (
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
    </div>
  );
}
