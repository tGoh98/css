import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { bookmarks } from "@/db/schema";

/**
 * POST { itemId } → add bookmark
 * DELETE { itemId } → remove bookmark
 *
 * Auth required. In v1 the `bookmarks` table is single-row-per-item (no user_id
 * column), which is fine since the allowlist gates to a single user. When we
 * promote to multi-user, add a `user_id` column + composite PK and pass it
 * through here.
 */

type Body = { itemId?: unknown };

async function parseItemId(req: Request): Promise<number | null> {
  try {
    const data = (await req.json()) as Body;
    const n = Number(data.itemId);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const itemId = await parseItemId(req);
  if (!itemId) return NextResponse.json({ error: "invalid itemId" }, { status: 400 });

  await db
    .insert(bookmarks)
    .values({ itemId })
    .onConflictDoNothing({ target: bookmarks.itemId });
  return NextResponse.json({ ok: true, bookmarked: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const itemId = await parseItemId(req);
  if (!itemId) return NextResponse.json({ error: "invalid itemId" }, { status: 400 });

  await db.delete(bookmarks).where(eq(bookmarks.itemId, itemId));
  return NextResponse.json({ ok: true, bookmarked: false });
}
