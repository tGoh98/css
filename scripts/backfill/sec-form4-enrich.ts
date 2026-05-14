/**
 * One-shot enrichment for existing SEC items in the DB.
 *
 *   tsx --env-file=.env.local scripts/backfill/sec-form4-enrich.ts
 *
 * Two passes:
 *   1. Normalize raw_json key names from the old backfill convention
 *      (`form`, `filingDate`, `primaryDoc`) to the live-ingester convention
 *      (`filing_type`, `filing_date`, `primary_document`).
 *   2. For every Form 4 row missing `reporter_name`, fetch and parse the
 *      Form 4 XML and merge the parsed fields back into `raw_json`.
 *      Polite: ~5 req/s to SEC.
 *
 * Re-runnable. Skips rows already enriched. Safe to interrupt.
 */

import { eq, sql } from "drizzle-orm";
import { fetchAndParseForm4 } from "@/ingest/sec-form4";
import { db } from "@/db";
import { items, sources } from "@/db/schema";
import { sleep } from "./_common";

const USER_AGENT = "Claudy Simple Server (CSS) backfill personal use; contact: timgoh98@gmail.com";

async function normalizeKeys(): Promise<number> {
  // jsonb_build_object trick: copy old → new key, drop old. Single SQL
  // statement, idempotent (skips rows where new keys already present).
  const res = await db.execute(sql`
    UPDATE items
    SET raw_json = (
      (raw_json - 'form' - 'filingDate' - 'primaryDoc')
      || jsonb_build_object(
        'filing_type', COALESCE(raw_json->'filing_type', raw_json->'form'),
        'filing_date', COALESCE(raw_json->'filing_date', raw_json->'filingDate'),
        'primary_document', COALESCE(raw_json->'primary_document', raw_json->'primaryDoc')
      )
    )
    FROM sources
    WHERE items.source_id = sources.id
      AND sources.kind = 'sec'
      AND (raw_json ? 'form' OR raw_json ? 'filingDate' OR raw_json ? 'primaryDoc')
  `);
  // postgres-js returns count under different fields depending on node-postgres vs sql call; just print whatever we got.
  return Number((res as { count?: number; rowCount?: number }).count ?? (res as { rowCount?: number }).rowCount ?? 0);
}

async function enrichForm4s(): Promise<{ enriched: number; skipped: number; failed: number }> {
  const rows = await db
    .select({ id: items.id, url: items.url, raw: items.rawJson })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(sql`${sources.kind} = 'sec' AND ${items.rawJson}->>'filing_type' IN ('4', '4/A') AND NOT (${items.rawJson} ? 'reporter_name')`);

  console.log(`[enrich] ${rows.length} Form 4 rows need enrichment`);

  let enriched = 0;
  const skipped = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const parsed = await fetchAndParseForm4(r.url, USER_AGENT);
      if (!parsed) {
        failed++;
        console.warn(`[enrich] parse failed for item ${r.id} (${r.url})`);
        await sleep(150);
        continue;
      }
      const merged = {
        ...(r.raw ?? {}),
        reporter_name: parsed.reporter_name,
        reporter_role: parsed.reporter_role,
        is_director: parsed.is_director,
        is_officer: parsed.is_officer,
        is_ten_percent_owner: parsed.is_ten_percent_owner,
        transaction_code: parsed.transactions[0]?.code ?? null,
        transaction: parsed.direction,
        shares: parsed.net_shares,
        value: parsed.total_value,
        transactions: parsed.transactions,
      };
      await db.update(items).set({ rawJson: merged }).where(eq(items.id, r.id));
      enriched++;
      if (enriched % 10 === 0) console.log(`[enrich] ${enriched}/${rows.length} done`);
      await sleep(150); // SEC ≤10 req/s; stay well under
    } catch (err) {
      failed++;
      console.error(`[enrich] item ${r.id} failed:`, err);
    }
  }
  return { enriched, skipped, failed };
}

async function main() {
  console.log("[enrich] normalizing raw_json keys…");
  const normalized = await normalizeKeys();
  console.log(`[enrich] normalize touched ~${normalized} rows`);

  console.log("[enrich] enriching Form 4 XML…");
  const out = await enrichForm4s();
  console.log(`[enrich] done`, out);
  process.exit(0);
}

main().catch((err) => {
  console.error("[enrich] failed:", err);
  process.exit(1);
});
