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
