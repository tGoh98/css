import { verifyCronSecret } from "@/lib/cron";

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;
  // Phase 2A: Reddit search ingest implementation.
  return Response.json({ ok: true, message: "stub" });
}
