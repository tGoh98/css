import { NextResponse } from "next/server";

/**
 * Verifies a Vercel Cron / manual invocation by checking the `Authorization`
 * header against `CRON_SECRET`. Vercel Cron will set this header automatically
 * if you configure the secret in env. Returns `null` on success or a
 * `NextResponse` to return immediately on failure.
 */
export function verifyCronSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
