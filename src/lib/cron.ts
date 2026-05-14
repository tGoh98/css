import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Verifies a Vercel Cron / manual invocation by checking the `Authorization`
 * header against `CRON_SECRET`. Vercel Cron will set this header automatically
 * if you configure the secret in env. Returns `null` on success or a
 * `NextResponse` to return immediately on failure.
 *
 * Uses crypto.timingSafeEqual so the comparison takes constant time
 * regardless of how many bytes of the secret match — pre-empts any
 * timing-attack analysis on the bearer token.
 */
export function verifyCronSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
