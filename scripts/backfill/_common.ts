/**
 * Shared helpers for backfill scripts.
 *
 * - Loads .env.local manually (no dotenv dep)
 * - Resolves CLI flags (--limit, --since)
 * - Resolves a source row by name+kind, inserting if missing
 * - Inserts an item and its classification (idempotent on (source_id, external_id))
 * - Dynamically imports the classifier (Phase 2A; may not exist yet)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, sources } from "@/db/schema";

// ---- env bootstrap ----------------------------------------------------------

const envLocal = resolve(process.cwd(), ".env.local");
if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// ---- CLI flags --------------------------------------------------------------

export function parseFlags(argv = process.argv.slice(2)): {
  limit: number | null;
  since: Date | null;
  extra: Record<string, string>;
} {
  const out: { limit: number | null; since: Date | null; extra: Record<string, string> } = {
    limit: null,
    since: null,
    extra: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit" && argv[i + 1]) {
      out.limit = Number.parseInt(argv[++i], 10);
    } else if (a.startsWith("--limit=")) {
      out.limit = Number.parseInt(a.slice("--limit=".length), 10);
    } else if (a === "--since" && argv[i + 1]) {
      out.since = new Date(argv[++i]);
    } else if (a.startsWith("--since=")) {
      out.since = new Date(a.slice("--since=".length));
    } else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) out.extra[a.slice(2, eq)] = a.slice(eq + 1);
      else out.extra[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    }
  }
  return out;
}

// ---- source upsert ----------------------------------------------------------

export type SourceSeed = {
  name: string;
  kind: string; // matches schema.sources.kind values
  category: "core" | "competitor";
  configJson?: Record<string, unknown>;
};

export async function ensureSource(seed: SourceSeed): Promise<number> {
  const existing = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.name, seed.name), eq(sources.kind, seed.kind)))
    .limit(1);
  if (existing.length > 0) return existing[0].id;
  const [row] = await db
    .insert(sources)
    .values({
      name: seed.name,
      kind: seed.kind,
      category: seed.category,
      configJson: seed.configJson ?? {},
      enabled: true,
    })
    .returning({ id: sources.id });
  return row.id;
}

// ---- item insert ------------------------------------------------------------

export type ItemInsert = {
  sourceId: number;
  externalId: string;
  url: string;
  title: string;
  snippet?: string | null;
  fullText?: string | null;
  author?: string | null;
  publishedAt: Date;
  rawJson?: Record<string, unknown> | null;
};

/**
 * Insert an item with `backfilled = true`. Returns the inserted id or `null`
 * if the row already existed (the (source_id, external_id) unique conflict).
 */
export async function insertBackfilledItem(input: ItemInsert): Promise<number | null> {
  const inserted = await db
    .insert(items)
    .values({
      sourceId: input.sourceId,
      externalId: input.externalId,
      url: input.url,
      title: input.title,
      snippet: input.snippet ?? null,
      fullText: input.fullText ?? null,
      author: input.author ?? null,
      publishedAt: input.publishedAt,
      rawJson: input.rawJson ?? null,
      backfilled: true,
    })
    .onConflictDoNothing({ target: [items.sourceId, items.externalId] })
    .returning({ id: items.id });
  return inserted[0]?.id ?? null;
}

// ---- classifier (lazy) ------------------------------------------------------

/**
 * Phase 2A's signature (see src/ai/classifier.ts). We mirror the field names
 * so we can pass values through directly without re-shaping at every call
 * site.
 */
export type ClassifyInput = {
  itemId: number;
  title: string;
  snippet?: string | null;
  url: string;
  sourceName: string;
  sourceKind: string;
};

type ClassifyFn = (input: ClassifyInput) => Promise<unknown>;

let cachedClassify: ClassifyFn | null | undefined;

async function loadClassifier(): Promise<ClassifyFn | null> {
  if (cachedClassify !== undefined) return cachedClassify;
  // Use a variable specifier so TS doesn't error if Phase 2A hasn't shipped
  // the module yet.
  const specifier = "@/ai/classifier";
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
    const fn = (mod.classifyItem ?? mod.classify) as ClassifyFn | undefined;
    if (!fn) {
      console.warn("[backfill] @/ai/classifier resolved but no classifyItem/classify export found");
      cachedClassify = null;
    } else {
      cachedClassify = fn;
    }
  } catch (err) {
    console.warn(
      "[backfill] @/ai/classifier not available yet (Phase 2A still writing it); items will be inserted without classification. " +
        (err instanceof Error ? `(${err.message})` : ""),
    );
    cachedClassify = null;
  }
  return cachedClassify;
}

/**
 * Call Phase 2A's classifier on an inserted item. The classifier itself
 * persists the classification row, drops low-relevance items, and fires
 * breaking-news notifications — we just hand off and swallow errors.
 */
export async function classifyAndStore(input: ClassifyInput): Promise<void> {
  const classify = await loadClassifier();
  if (!classify) return; // no classifier yet — leave raw item; cron may pick it up later
  try {
    await classify(input);
  } catch (err) {
    console.error(`[backfill] classifier failed for item ${input.itemId}:`, err);
  }
}

// ---- misc -------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export function logProgress(source: string, kept: number, scanned: number): void {
  console.log(`[backfill:${source}] scanned=${scanned} kept=${kept}`);
}
