import { verifyCronSecret } from "@/lib/cron";
import { ingest as ingestFigmaBlog } from "@/ingest/figma-blog";
import { ingest as ingestSec } from "@/ingest/sec";
import { ingest as ingestCompetitors } from "@/ingest/competitors";
import { clusterRecent } from "@/ai/cluster";
import { notifyIngestSaturation } from "@/notify";
import type { IngestResult } from "@/ingest/_shared";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const ingests = await Promise.allSettled([
    ingestFigmaBlog(),
    ingestSec(),
    ingestCompetitors(),
  ]);

  const labeled = (["figmaBlog", "sec", "competitors"] as const).map(
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
  if (warnings.length > 0) await notifyIngestSaturation("tick-hourly", warnings);

  const [figmaBlog, sec, competitors] = labeled.map((l) => l.value);

  let cluster: unknown;
  try {
    cluster = await clusterRecent();
  } catch (e) {
    cluster = { error: e instanceof Error ? e.message : String(e) };
  }

  return Response.json({ ok: true, figmaBlog, sec, competitors, cluster, warnings });
}
