import { verifyCronSecret } from "@/lib/cron";
import { ingest as ingestCompetitors } from "@/ingest/competitors";
import { ingest as ingestAnalyst } from "@/ingest/analyst";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Hourly cron tick covering competitors (Adobe / Canva / Sketch / Penpot)
 * plus analyst signal (Yahoo Finance + Seeking Alpha for FIG). Both are
 * lower-cadence than the main news/reddit/hn cycle, so we bundle them under
 * one route to keep `vercel.json` simple.
 */
export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;
  const a = await ingestCompetitors();
  const b = await ingestAnalyst();
  return Response.json({
    ok: true,
    inserted: a.inserted + b.inserted,
    skipped: a.skipped + b.skipped,
    errors: [...a.errors, ...b.errors],
  });
}
