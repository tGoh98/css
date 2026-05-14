import { verifyCronSecret } from "@/lib/cron";
import { ingest as ingestFigmaBlog } from "@/ingest/figma-blog";
import { ingest as ingestSec } from "@/ingest/sec";
import { ingest as ingestCompetitors } from "@/ingest/competitors";
import { ingest as ingestAnalyst } from "@/ingest/analyst";
import { clusterRecent } from "@/ai/cluster";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel Hobby caps cron jobs at 2/project. Hourly ingests + clustering live
// here. Cluster runs after the ingests so it picks up fresh items.
export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;

  const ingests = await Promise.allSettled([
    ingestFigmaBlog(),
    ingestSec(),
    ingestCompetitors(),
    ingestAnalyst(),
  ]);
  const [figmaBlog, sec, competitors, analyst] = ingests.map((r) =>
    r.status === "fulfilled" ? r.value : { error: String(r.reason) },
  );

  let cluster: unknown;
  try {
    cluster = await clusterRecent();
  } catch (e) {
    cluster = { error: e instanceof Error ? e.message : String(e) };
  }

  return Response.json({ ok: true, figmaBlog, sec, competitors, analyst, cluster });
}
