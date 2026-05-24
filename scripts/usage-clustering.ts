/**
 * Read-only access-pattern analysis: how clustered in time are classify
 * calls? Used to decide whether prompt caching (5-min TTL) would have
 * anything to hit if we paid the padding cost to cross Haiku's ~4096-tok
 * cache floor.
 *
 * Usage:
 *   npm exec tsx -- --env-file=.env.local scripts/usage-clustering.ts
 *
 * Originally written 2026-05-24 for the "is caching worth it?" question
 * (see ARCHITECTURE.md decision log). Worth rerunning after any change to
 * the classifier batching parameters to confirm the call-clustering shape
 * hasn't moved. Tables read: `ai_usage`. Performs no writes.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

async function main() {
  // For each classify call, how long since the previous classify call?
  const gaps = await db.execute(sql`
    WITH ordered AS (
      SELECT
        created_at,
        item_count,
        LAG(created_at) OVER (ORDER BY created_at) AS prev
      FROM ai_usage
      WHERE job = 'classify' AND created_at > now() - interval '7 days'
    )
    SELECT
      width_bucket(
        EXTRACT(EPOCH FROM (created_at - prev)),
        0, 600, 12
      ) AS bucket,
      COUNT(*)::int AS calls
    FROM ordered
    WHERE prev IS NOT NULL
    GROUP BY bucket
    ORDER BY bucket;
  `);
  console.log("\n=== gap-between-consecutive-classify-calls histogram (7d) ===");
  console.log("(buckets are 50s wide from 0..600s; bucket 13 = >600s)");
  console.table(gaps);

  // How many classify calls within a 5-minute window of each call?
  const withinWindow = await db.execute(sql`
    SELECT
      width_bucket(neighbors, 0, 30, 6) AS bucket,
      COUNT(*)::int AS calls
    FROM (
      SELECT
        created_at,
        (
          SELECT COUNT(*) FROM ai_usage b
          WHERE b.job = 'classify'
            AND b.created_at >= a.created_at - interval '5 minutes'
            AND b.created_at <= a.created_at + interval '5 minutes'
            AND b.created_at != a.created_at
        ) AS neighbors
      FROM ai_usage a
      WHERE a.job = 'classify' AND a.created_at > now() - interval '7 days'
    ) t
    GROUP BY bucket
    ORDER BY bucket;
  `);
  console.log("\n=== neighbors-within-5min histogram (7d) ===");
  console.log("(bucket 1 = 0-5 neighbors, 2 = 6-10, ..., 7 = >30)");
  console.table(withinWindow);

  // Burst sizes: count classify calls per minute, look at the distribution
  const perMinute = await db.execute(sql`
    SELECT
      width_bucket(calls_in_minute, 0, 40, 8) AS bucket,
      COUNT(*)::int AS minutes
    FROM (
      SELECT date_trunc('minute', created_at) AS m, COUNT(*) AS calls_in_minute
      FROM ai_usage
      WHERE job = 'classify' AND created_at > now() - interval '7 days'
      GROUP BY m
    ) t
    GROUP BY bucket
    ORDER BY bucket;
  `);
  console.log("\n=== calls-per-minute distribution (7d, only minutes with ≥1 call) ===");
  console.log("(bucket 1 = 1-5 calls/min, 2 = 6-10, ..., 9 = >40)");
  console.table(perMinute);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
