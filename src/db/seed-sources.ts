/**
 * Seed-sources helper. Idempotently inserts one `sources` row per known
 * provider so the UI / cron / backfill all have stable source IDs to point
 * at even before the first ingest tick has run. Safe to call repeatedly:
 * we look up by (name, kind) and only insert if missing.
 *
 * Called by Phase 2C's `scripts/seed.ts`. The individual ingest pollers also
 * call `ensureSource(...)` defensively so this seed isn't a hard prereq —
 * it just gets things into a known state up front.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { sources } from "./schema";

interface SeedRow {
  name: string;
  kind: string;
  category: "core" | "competitor";
  configJson: Record<string, unknown>;
}

const SEED: SeedRow[] = [
  {
    name: "Google News (Figma)",
    kind: "news",
    category: "core",
    configJson: {
      query: "Figma",
      feedUrl: "https://news.google.com/rss/search?q=Figma&hl=en-US&gl=US&ceid=US:en",
    },
  },
  {
    name: "SEC EDGAR (Figma)",
    kind: "sec",
    category: "core",
    configJson: {
      cik: "0001579878",
      tickers: ["FIG"],
      kept_forms: ["10-K", "10-Q", "8-K", "S-1", "S-1/A", "4", "4/A"],
    },
  },
  {
    name: "Figma Blog",
    kind: "blog",
    category: "core",
    configJson: { indexUrl: "https://www.figma.com/blog/", mode: "scrape" },
  },
  {
    name: "Reddit search (Figma)",
    kind: "reddit",
    category: "core",
    configJson: {
      subreddits: ["Figma", "stocks", "wallstreetbets", "investing", "design"],
      query: "Figma",
    },
  },
  {
    name: "Hacker News (Figma)",
    kind: "hn",
    category: "core",
    configJson: { query: "Figma", endpoint: "search_by_date" },
  },
  {
    name: "Yahoo Finance analyst (FIG)",
    kind: "news",
    category: "core",
    configJson: { ticker: "FIG", kind: "analyst-ratings" },
  },
  {
    name: "Seeking Alpha (FIG)",
    kind: "news",
    category: "core",
    configJson: {
      ticker: "FIG",
      feedUrl: "https://seekingalpha.com/api/sa/combined/FIG.xml",
    },
  },
  // Competitors
  {
    name: "Google News (Adobe)",
    kind: "competitor-news",
    category: "competitor",
    configJson: { brand: "Adobe", query: "Adobe design tool" },
  },
  {
    name: "Google News (Canva)",
    kind: "competitor-news",
    category: "competitor",
    configJson: { brand: "Canva", query: "Canva" },
  },
  {
    name: "Sketch blog",
    kind: "competitor-blog",
    category: "competitor",
    configJson: {
      brand: "Sketch",
      feedUrl: "https://www.sketch.com/blog/feed/",
      note: "URL unverified — may 404",
    },
  },
  {
    name: "Penpot blog",
    kind: "competitor-blog",
    category: "competitor",
    configJson: {
      brand: "Penpot",
      feedUrl: "https://penpot.app/blog/feed.xml",
      note: "URL unverified — may 404",
    },
  },
  {
    name: "Penpot GitHub releases",
    kind: "competitor-blog",
    category: "competitor",
    configJson: { brand: "Penpot", repo: "penpot/penpot", kind: "github-releases" },
  },
];

export async function seedSources(): Promise<void> {
  for (const row of SEED) {
    const existing = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.name, row.name), eq(sources.kind, row.kind)))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(sources).values({
      name: row.name,
      kind: row.kind,
      category: row.category,
      configJson: row.configJson,
    });
  }
}
