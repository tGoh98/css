/**
 * Read-only ingest health check — recent items per source kind, per-source
 * recency (catches dead pollers), and the unclassified backlog. Useful for
 * spot-checking "did anything ingest in the last day?" without opening a SQL
 * client.
 *
 * Usage:
 *   npm exec tsx -- --env-file=.env.local scripts/ingest-health.ts
 *
 * Tables read: `items`, `sources`, `item_classifications`. Performs no writes.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

async function main() {
  // Recent ingest activity: items added in last 7d by source kind
  const ingest = await db.execute(sql`
    SELECT
      s.kind,
      COUNT(*)::int AS items_24h,
      MAX(i.fetched_at)::text AS last_item_at
    FROM items i
    JOIN sources s ON s.id = i.source_id
    WHERE i.fetched_at > now() - interval '24 hours'
    GROUP BY s.kind
    ORDER BY items_24h DESC;
  `);
  console.log("\n=== items ingested per kind (last 24h) ===");
  console.table(ingest);

  // Per-source recency (any source with no items in 48h is suspect)
  const stale = await db.execute(sql`
    SELECT
      s.kind, s.name,
      MAX(i.fetched_at)::text AS last_item_at,
      (now() - MAX(i.fetched_at))::text AS gap
    FROM sources s
    LEFT JOIN items i ON i.source_id = s.id
    GROUP BY s.kind, s.name
    ORDER BY MAX(i.fetched_at) NULLS FIRST
    LIMIT 30;
  `);
  console.log("\n=== sources by oldest last item ===");
  console.table(stale);

  // Unclassified backlog
  const backlog = await db.execute(sql`
    SELECT COUNT(*)::int AS unclassified
    FROM items i
    LEFT JOIN item_classifications c ON c.item_id = i.id
    WHERE c.item_id IS NULL;
  `);
  console.log("\n=== classifier backlog (items without classification) ===");
  console.table(backlog);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
