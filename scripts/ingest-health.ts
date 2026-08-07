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

  // Per-source recency (any source with no items in 48h is suspect).
  // Disabled sources are excluded — a deliberately-retired source is not a
  // health signal, and leaving them in trains you to ignore the list.
  const stale = await db.execute(sql`
    SELECT
      s.kind, s.name,
      MAX(i.fetched_at)::text AS last_item_at,
      (now() - MAX(i.fetched_at))::text AS gap
    FROM sources s
    LEFT JOIN items i ON i.source_id = s.id
    WHERE s.enabled
    GROUP BY s.kind, s.name
    ORDER BY MAX(i.fetched_at) NULLS FIRST
    LIMIT 30;
  `);
  console.log("\n=== sources by oldest last item (enabled only) ===");
  console.table(stale);

  // Enabled sources that have NEVER produced an item. These are a different
  // failure class from "stale": a stale source worked once and stopped, so the
  // gap column eventually screams. A never-succeeded source has no gap to
  // measure and hides at the top of the list forever behind a null — which is
  // how `Sketch blog` and `Penpot blog` sat broken from creation until
  // 2026-08-06 (both seeded with URLs that 404'd, both config-flagged
  // "URL unverified — may 404", neither ever escalated).
  const neverIngested = await db.execute(sql`
    SELECT
      s.id, s.kind, s.name,
      s.last_polled_at::text AS last_polled_at,
      s.config_json->>'feedUrl' AS feed_url
    FROM sources s
    LEFT JOIN items i ON i.source_id = s.id
    WHERE s.enabled
    GROUP BY s.id, s.kind, s.name, s.last_polled_at, s.config_json
    HAVING COUNT(i.id) = 0
    ORDER BY s.id;
  `);
  console.log("\n=== NEVER ingested (enabled sources with zero items) ===");
  if ((neverIngested as unknown as unknown[]).length === 0) {
    console.log("(none — every enabled source has produced at least one item)");
  } else {
    console.table(neverIngested);
    console.log(
      "^ These have produced nothing since creation. Check the feed URL actually resolves.",
    );
  }

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
