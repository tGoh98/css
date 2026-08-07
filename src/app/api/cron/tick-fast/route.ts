import { verifyCronSecret } from "@/lib/cron";
import { ingest as ingestNews } from "@/ingest/news";
import { ingest as ingestReddit } from "@/ingest/reddit";
import { ingest as ingestHn } from "@/ingest/hn";
import { notifyIngestSaturation } from "@/notify";
import type { IngestResult } from "@/ingest/_shared";

export const runtime = "nodejs";
export const maxDuration = 60;

// Fan-out over the fast-moving sources (news / reddit / hn).
//
// Naming: this was `tick-15m` until 2026-08-06, which described a cadence no
// caller ever used. Nothing runs this every 15 minutes — GitHub Actions drives
// the real cadence by hitting the per-source `ingest/*` routes directly
// (*/5 for these three), and Vercel Cron invokes THIS route once a day as a
// safety net because Hobby caps cron frequency at daily and 2 jobs/project.
// The name now describes the source tier, not a schedule.
export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const results = await Promise.allSettled([
    ingestNews(),
    ingestReddit(),
    ingestHn(),
  ]);

  const labeled = (["news", "reddit", "hn"] as const).map((label, i) => {
    const r = results[i];
    return {
      label,
      value:
        r.status === "fulfilled"
          ? r.value
          : ({ inserted: 0, skipped: 0, errors: [String(r.reason)], warnings: [] } as IngestResult),
    };
  });

  const warnings = labeled.flatMap(({ label, value }) =>
    (value.warnings ?? []).map((w) => `[${label}] ${w}`),
  );
  if (warnings.length > 0) await notifyIngestSaturation("tick-fast", warnings);

  const [news, reddit, hn] = labeled.map((l) => l.value);
  return Response.json({ ok: true, news, reddit, hn, warnings });
}
