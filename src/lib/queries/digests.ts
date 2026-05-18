import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { digests } from "@/db/schema";

export type DigestRow = typeof digests.$inferSelect;

export async function fetchDigestById(id: number): Promise<DigestRow | null> {
  const [row] = await db.select().from(digests).where(eq(digests.id, id)).limit(1);
  return row ?? null;
}

export async function listDigests(
  period?: string,
  limit = 50,
  offset = 0,
): Promise<DigestRow[]> {
  const q = db
    .select()
    .from(digests)
    // Order by the period the digest *covers*, not when it starts: a weekly's
    // period_start is the Monday, which sinks it below every daily in the same
    // week. period_end ranks a weekly alongside the last day it covers.
    .orderBy(desc(digests.periodEnd), desc(digests.generatedAt))
    .limit(limit)
    .offset(offset);
  if (period) return q.where(eq(digests.period, period));
  return q;
}

/**
 * Latest digest of each period (day / week / month) for the home dashboard.
 * Returns up to 3 rows in the order day → week → month. Drops periods that
 * have no rows yet.
 */
export async function fetchRecentDigestSet(): Promise<DigestRow[]> {
  const [day, week, month] = await Promise.all([
    db.select().from(digests).where(eq(digests.period, "day")).orderBy(desc(digests.periodStart)).limit(1),
    db.select().from(digests).where(eq(digests.period, "week")).orderBy(desc(digests.periodStart)).limit(1),
    db.select().from(digests).where(eq(digests.period, "month")).orderBy(desc(digests.periodStart)).limit(1),
  ]);
  return [...day, ...week, ...month];
}
