import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { itemNotes } from "@/db/schema";

const MAX_BODY = 20_000;

/**
 * PUT /api/items/[id]/notes  { body: string }
 *
 * Upsert the user's note for an item. Same single-user-v1 caveat as bookmarks —
 * the table is single-row-per-item today.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: string;
  try {
    const data = (await req.json()) as { body?: unknown };
    body = typeof data.body === "string" ? data.body : "";
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: "body too large" }, { status: 413 });
  }

  await db
    .insert(itemNotes)
    .values({ itemId, bodyMd: body, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: itemNotes.itemId,
      set: { bodyMd: body, updatedAt: new Date() },
    });
  return NextResponse.json({ ok: true });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const [row] = await db.select().from(itemNotes).where(eq(itemNotes.itemId, itemId)).limit(1);
  return NextResponse.json({ body: row?.bodyMd ?? "" });
}
