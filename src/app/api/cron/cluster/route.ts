import { verifyCronSecret } from "@/lib/cron";
import { clusterRecent } from "@/ai/cluster";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;
  const r = await clusterRecent();
  return Response.json({
    ok: true,
    inserted: r.clustersCreated,
    skipped: r.itemsConsidered - r.itemsAssigned,
    errors: r.errors,
    itemsConsidered: r.itemsConsidered,
    itemsAssigned: r.itemsAssigned,
  });
}
