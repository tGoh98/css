import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { notifyDigest } from "@/notify";

/**
 * POST /api/webhooks/digest-published
 *
 * Called by the local digest worker (Phase 2D) after it writes a row into the
 * `digests` table. The worker can run on the owner's Mac which has no Resend
 * credentials of its own; this Vercel Function holds the keys and fans out.
 *
 * Body: { digestId: number | string, secret: string }
 * Auth: `secret` must match env `DIGEST_WEBHOOK_SECRET`. Compared in
 * constant time via crypto.timingSafeEqual.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.DIGEST_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "DIGEST_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  let body: { digestId?: number | string; secret?: string };
  try {
    body = (await request.json()) as { digestId?: number | string; secret?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provided = body.secret ?? "";
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (body.digestId === undefined || body.digestId === null) {
    return NextResponse.json({ error: "Missing digestId" }, { status: 400 });
  }

  // Fire-and-await; notifyDigest swallows its own errors.
  await notifyDigest(body.digestId);
  return NextResponse.json({ ok: true });
}
