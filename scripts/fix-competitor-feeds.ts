/**
 * One-off repair for the two competitor blog sources that had never ingested
 * a single item since they were created (both `last_polled_at IS NULL`).
 *
 * Both rows were seeded speculatively — their `config_json` literally carried
 * `"note": "URL unverified — may 404"`, and both URLs did in fact 404. The
 * poller records the failure into `result.errors` per run, but nothing
 * escalates a source that has *never* succeeded, so they sat dead silently.
 *
 * Verified 2026-08-06:
 *   https://www.sketch.com/blog/feed/     → 404   (what the row had)
 *   https://www.sketch.com/blog/feed.xml  → 200 application/xml  ✅
 *   https://penpot.app/blog/feed.xml      → 404
 *   https://penpot.app/blog/rss.xml       → 404
 *   https://penpot.app/atom.xml           → 404
 *   https://penpot.app/feed.xml           → 404
 *   https://penpot.app/blog/index.xml     → 404
 *
 * Penpot publishes no blog feed, so that row is disabled rather than left
 * failing forever. Penpot product news is already covered by the working
 * "Penpot GitHub releases" source. (A Discourse feed does exist at
 * https://community.penpot.app/latest.rss — that is user forum chatter, not
 * the blog, so it is deliberately NOT substituted here.)
 *
 * Idempotent: re-running is a no-op.
 *
 * Usage:
 *   npm exec tsx -- --env-file=.env.local scripts/fix-competitor-feeds.ts
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";

const SKETCH_FEED = "https://www.sketch.com/blog/feed.xml";

async function main() {
  const rows = await db.select().from(sources);

  const sketch = rows.find((r) => r.name === "Sketch blog");
  if (!sketch) {
    console.log("Sketch blog: row not found — skipping");
  } else {
    const cfg = { ...((sketch.configJson ?? {}) as Record<string, unknown>) };
    delete cfg.note;
    cfg.feedUrl = SKETCH_FEED;
    cfg.method = "rss";
    cfg.brand = cfg.brand ?? "Sketch";
    await db
      .update(sources)
      .set({ configJson: cfg, enabled: true })
      .where(eq(sources.id, sketch.id));
    console.log(`Sketch blog (id=${sketch.id}): feedUrl → ${SKETCH_FEED}, enabled`);
  }

  const penpot = rows.find((r) => r.name === "Penpot blog");
  if (!penpot) {
    console.log("Penpot blog: row not found — skipping");
  } else {
    const cfg = { ...((penpot.configJson ?? {}) as Record<string, unknown>) };
    cfg.note =
      "Disabled 2026-08-06: penpot.app publishes no blog RSS/Atom feed (all " +
      "candidate URLs 404). Product news is covered by 'Penpot GitHub releases'. " +
      "If a feed appears, set feedUrl and re-enable.";
    await db
      .update(sources)
      .set({ configJson: cfg, enabled: false })
      .where(eq(sources.id, penpot.id));
    console.log(`Penpot blog (id=${penpot.id}): disabled (no feed exists upstream)`);
  }

  process.exit(0);
}

main();
