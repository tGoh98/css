import { verifyCronSecret } from "@/lib/cron";
import { ingest } from "@/ingest/hn";
import { notifyIngestSaturation } from "@/notify";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;
  const { inserted, skipped, errors, warnings } = await ingest();
  if (warnings.length > 0) await notifyIngestSaturation("hn", warnings);
  return Response.json({ ok: true, inserted, skipped, errors, warnings });
}
