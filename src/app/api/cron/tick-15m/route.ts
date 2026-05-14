import { verifyCronSecret } from "@/lib/cron";
import { ingest as ingestNews } from "@/ingest/news";
import { ingest as ingestReddit } from "@/ingest/reddit";
import { ingest as ingestHn } from "@/ingest/hn";

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

  const [news, reddit, hn] = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: String(r.reason) },
  );

  return Response.json({ ok: true, news, reddit, hn });
}
