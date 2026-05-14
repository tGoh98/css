import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { digests } from "@/db/schema";

export type DigestRow = typeof digests.$inferSelect;

export async function listDigests(
  period?: "day" | "week" | "month",
  limit = 50,
  offset = 0,
): Promise<DigestRow[]> {
  const q = db
    .select()
    .from(digests)
    .orderBy(desc(digests.periodStart))
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
