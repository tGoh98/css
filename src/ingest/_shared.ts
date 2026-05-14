/**
 * Helpers shared across all source pollers. Kept small + dependency-free
 * (re-uses what's already in package.json).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { items, sources } from "@/db/schema";
import { classifyItem } from "@/ai/classifier";

export const USER_AGENT = "CSS Aggregator timgoh98@gmail.com";

export interface IngestResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

export function emptyResult(): IngestResult {
  return { inserted: 0, skipped: 0, errors: [] };
}

export interface SourceKey {
  name: string;
  kind: string; // 'news'|'sec'|'blog'|'reddit'|'hn'|'competitor-news'|'competitor-blog'
  category: "core" | "competitor";
  configJson?: Record<string, unknown>;
}

/**
 * Get-or-create a source row keyed by (name, kind). Returns its id.
 * Used by pollers so they don't depend on the seed script having run.
 */
export async function ensureSource(key: SourceKey): Promise<number> {
  const existing = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.name, key.name), eq(sources.kind, key.kind)))
    .limit(1);
  if (existing.length > 0) return existing[0].id;
  const [row] = await db
    .insert(sources)
    .values({
      name: key.name,
      kind: key.kind,
      category: key.category,
      configJson: key.configJson ?? {},
    })
    .returning({ id: sources.id });
  return row.id;
}

/** Stamp `sources.last_polled_at = now()`. */
export async function markPolled(sourceId: number): Promise<void> {
  await db
    .update(sources)
    .set({ lastPolledAt: new Date() })
    .where(eq(sources.id, sourceId));
}

export interface NewItem {
  externalId: string;
  url: string;
  title: string;
  snippet?: string | null;
  fullText?: string | null;
  author?: string | null;
  publishedAt: Date;
  rawJson?: Record<string, unknown> | null;
  backfilled?: boolean;
}

/**
 * Insert an item (idempotent on (source_id, external_id)). If a new row was
 * inserted, run the AI classifier against it. Returns whether the row was
 * inserted vs skipped.
 */
export async function insertAndClassify(
  sourceId: number,
  sourceName: string,
  sourceKind: string,
  item: NewItem,
  result: IngestResult,
): Promise<void> {
  try {
    const inserted = await db
      .insert(items)
      .values({
        sourceId,
        externalId: item.externalId,
        url: item.url,
        title: item.title,
        snippet: item.snippet ?? null,
        fullText: item.fullText ?? null,
        author: item.author ?? null,
        publishedAt: item.publishedAt,
        rawJson: item.rawJson ?? null,
        backfilled: item.backfilled ?? false,
      })
      .onConflictDoNothing({ target: [items.sourceId, items.externalId] })
      .returning({ id: items.id });

    if (inserted.length === 0) {
      result.skipped += 1;
      return;
    }

    const itemId = inserted[0].id;
    const classification = await classifyItem({
      itemId,
      title: item.title,
      snippet: item.snippet ?? null,
      url: item.url,
      sourceName,
      sourceKind,
    });

    if (classification.kind === "classified") {
      result.inserted += 1;
    } else if (classification.kind === "dropped") {
      // Low-relevance items are deleted by the classifier; count as skipped.
      result.skipped += 1;
    } else {
      result.errors.push(`classify item ${itemId}: ${classification.error}`);
      // Still count as inserted since the row exists; next run won't re-insert
      // (external_id collides) and won't re-classify (row exists check).
      result.inserted += 1;
    }
  } catch (err) {
    result.errors.push(
      `insert ${item.externalId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Fetch helper with a real User-Agent (required by EDGAR, helpful elsewhere).
 * Throws on non-2xx.
 */
export async function fetchWith(
  url: string,
  init: RequestInit = {},
  ua: string = USER_AGENT,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", ua);
  if (!headers.has("accept")) headers.set("accept", "application/json,application/xml,text/xml,text/html,*/*");
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
  }
  return res;
}

/** Hash-free unique id helper for sources that don't expose one. */
export function urlAsExternalId(url: string): string {
  // strip query fragments for stability
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
