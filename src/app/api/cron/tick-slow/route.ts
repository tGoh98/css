import { verifyCronSecret } from "@/lib/cron";
import { ingest as ingestFigmaBlog } from "@/ingest/figma-blog";
import { ingest as ingestSec } from "@/ingest/sec";
import { ingest as ingestCompetitors } from "@/ingest/competitors";
import { reclassifyOrphans } from "@/ingest/reclassify";
import { clusterRecent } from "@/ai/cluster";
import { notifyIngestSaturation } from "@/notify";
import type { IngestResult } from "@/ingest/_shared";

export const runtime = "nodejs";
export const maxDuration = 60;

// Fan-out over the slow-moving sources (figma-blog / sec / competitors) plus
// clustering.
//
// Naming: this was `tick-hourly` until 2026-08-06, which described a cadence
// no caller ever used. GitHub Actions drives the real cadence by hitting the
// per-source `ingest/*` routes directly (hourly for these), and Vercel Cron
// invokes THIS route once a day as a safety net — Hobby caps cron frequency at
// daily and 2 jobs/project. The name now describes the source tier.
export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const ingests = await Promise.allSettled([
    ingestFigmaBlog(),
    ingestSec(),
    ingestCompetitors(),
    // Sweep items whose classify call errored at insert time. Without this
    // they are orphaned permanently — invisible to the Feed and the digest,
    // which both inner-join classifications.
    reclassifyOrphans(),
  ]);

  const labeled = (["figmaBlog", "sec", "competitors", "reclassify"] as const).map(
    (label, i) => {
      const r = ingests[i];
      return {
        label,
        value:
          r.status === "fulfilled"
            ? r.value
            : ({ inserted: 0, skipped: 0, errors: [String(r.reason)], warnings: [] } as IngestResult),
      };
    },
  );

  const warnings = labeled.flatMap(({ label, value }) =>
    (value.warnings ?? []).map((w) => `[${label}] ${w}`),
  );
  if (warnings.length > 0) await notifyIngestSaturation("tick-slow", warnings);

  const [figmaBlog, sec, competitors, reclassify] = labeled.map((l) => l.value);

  let cluster: unknown;
  try {
    cluster = await clusterRecent();
  } catch (e) {
    cluster = { error: e instanceof Error ? e.message : String(e) };
  }

  return Response.json({
    ok: true,
    figmaBlog,
    sec,
    competitors,
    reclassify,
    cluster,
    warnings,
  });
}
