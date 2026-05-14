import { verifyCronSecret } from "@/lib/cron";
import { ingest } from "@/ingest/chart";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;
  const { inserted, skipped, errors } = await ingest();
  return Response.json({ ok: true, inserted, skipped, errors });
}
