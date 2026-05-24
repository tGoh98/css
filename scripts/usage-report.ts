/**
 * Read-only usage report — Anthropic API spend, batch coalescing, and digest
 * history. Useful for spot-checking "what did the classifier cost this week?"
 * and "are any digests missing?" without opening a SQL client.
 *
 * Usage:
 *   npm exec tsx -- --env-file=.env.local scripts/usage-report.ts
 *
 * Tables read: `ai_usage`, `digests`. Performs no writes.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

function show(label: string, rows: unknown) {
  console.log(`\n=== ${label} ===`);
  console.table(rows);
}

async function main() {
  const byJob7d = await db.execute(sql`
    SELECT
      job,
      model,
      COUNT(*)::int                       AS calls,
      SUM(item_count)::int                AS items_covered,
      SUM(input_tokens)::int              AS in_tok,
      SUM(cache_read_input_tokens)::int   AS cache_read,
      SUM(cache_write_input_tokens)::int  AS cache_write,
      SUM(output_tokens)::int             AS out_tok
    FROM ai_usage
    WHERE created_at > now() - interval '7 days'
    GROUP BY job, model
    ORDER BY job, model;
  `);
  show("ai_usage, last 7 days, by job+model", byJob7d);

  const totals30 = await db.execute(sql`
    SELECT
      model,
      COUNT(*)::int                       AS calls,
      SUM(item_count)::int                AS items_covered,
      SUM(input_tokens)::int              AS in_tok,
      SUM(cache_read_input_tokens)::int   AS cache_read,
      SUM(cache_write_input_tokens)::int  AS cache_write,
      SUM(output_tokens)::int             AS out_tok
    FROM ai_usage
    WHERE created_at > now() - interval '30 days'
    GROUP BY model
    ORDER BY model;
  `);
  show("ai_usage, last 30 days, by model", totals30);

  const hourly = await db.execute(sql`
    SELECT
      to_char(date_trunc('hour', created_at), 'MM-DD HH24:00') AS hour,
      job,
      COUNT(*)::int                       AS calls,
      SUM(item_count)::int                AS items,
      SUM(input_tokens)::int              AS in_tok,
      SUM(cache_read_input_tokens)::int   AS cache_read,
      SUM(output_tokens)::int             AS out_tok
    FROM ai_usage
    WHERE created_at > now() - interval '24 hours'
    GROUP BY hour, job
    ORDER BY hour DESC, job;
  `);
  show("ai_usage, last 24h, hourly", hourly);

  const batchSizes = await db.execute(sql`
    SELECT
      job,
      COUNT(*)::int                       AS calls,
      MIN(item_count)::int                AS min_items,
      ROUND(AVG(item_count)::numeric, 2)  AS avg_items,
      MAX(item_count)::int                AS max_items
    FROM ai_usage
    WHERE created_at > now() - interval '7 days'
    GROUP BY job
    ORDER BY job;
  `);
  show("ai_usage, batch sizes, last 7d", batchSizes);

  const digestRecent = await db.execute(sql`
    SELECT
      id,
      period,
      to_char(period_start, 'YYYY-MM-DD') AS period_start,
      to_char(period_end,   'YYYY-MM-DD') AS period_end,
      model,
      to_char(generated_at, 'YYYY-MM-DD HH24:MI') AS generated_at,
      CASE
        WHEN summary_md IS NULL THEN 'FAILED (null)'
        ELSE 'ok (' || length(summary_md) || ' chars)'
      END AS status
    FROM digests
    WHERE summary_md IS NULL
       OR generated_at > now() - interval '30 days'
    ORDER BY generated_at DESC NULLS FIRST
    LIMIT 40;
  `);
  show("digests: any failed + last 30 days", digestRecent);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
