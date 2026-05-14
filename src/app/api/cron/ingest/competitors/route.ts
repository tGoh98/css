import { verifyCronSecret } from "@/lib/cron";
import { ingest as ingestCompetitors } from "@/ingest/competitors";
import { notifyIngestSaturation } from "@/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;
  const { inserted, skipped, errors, warnings } = await ingestCompetitors();
  if (warnings.length > 0) await notifyIngestSaturation("competitors", warnings);
  return Response.json({ ok: true, inserted, skipped, errors, warnings });
}
