import { verifyCronSecret } from "@/lib/cron";
import { ingest as ingestFigmaBlog } from "@/ingest/figma-blog";
import { ingest as ingestSec } from "@/ingest/sec";
import { ingest as ingestCompetitors } from "@/ingest/competitors";
import { clusterRecent } from "@/ai/cluster";

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
  const [figmaBlog, sec, competitors] = ingests.map((r) =>
    r.status === "fulfilled" ? r.value : { error: String(r.reason) },
  );

  let cluster: unknown;
  try {
    cluster = await clusterRecent();
  } catch (e) {
    cluster = { error: e instanceof Error ? e.message : String(e) };
  }

  return Response.json({ ok: true, figmaBlog, sec, competitors, cluster });
}
