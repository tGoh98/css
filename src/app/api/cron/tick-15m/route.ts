import { verifyCronSecret } from "@/lib/cron";
import { ingest as ingestNews } from "@/ingest/news";
import { ingest as ingestReddit } from "@/ingest/reddit";
import { ingest as ingestHn } from "@/ingest/hn";
import { notifyIngestSaturation } from "@/notify";
import type { IngestResult } from "@/ingest/_shared";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel Hobby caps cron jobs at 2/project, so the high-frequency ingests
// are consolidated here. The per-source routes still exist for manual runs.
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
  if (warnings.length > 0) await notifyIngestSaturation("tick-15m", warnings);

  const [news, reddit, hn] = labeled.map((l) => l.value);
  return Response.json({ ok: true, news, reddit, hn, warnings });
}
