/**
 * Local digest worker — runs on the owner's Mac via launchd.
 *
 * Pulls items for the requested period from Neon, builds a prompt, invokes
 * `claude --print` (Opus via Max plan — see CLAUDE_MODEL for why), parses
 * Markdown output, and writes a row into the `digests` table.
 *
 * Usage:
 *   tsx scripts/run-digest.ts --period day   --date 2026-05-12
 *   tsx scripts/run-digest.ts --period week  --date 2026-05-04
 *   tsx scripts/run-digest.ts --period month --date 2026-04-01
 *   tsx scripts/run-digest.ts --period day   --catch-up
 *
 * Reads env (DATABASE_URL, APP_URL, DIGEST_WEBHOOK_SECRET) from
 * ~/.config/css/digest.env (one KEY=VAL per line).
 *
 * Hard failures exit 1. Per-period generation failures are logged and the
 * next period is attempted. Exits 0 on success.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Env loading — read ~/.config/css/digest.env before anything else.
// ---------------------------------------------------------------------------

const HOME = process.env.HOME || homedir();
const ENV_FILE = resolve(HOME, ".config/css/digest.env");

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip surrounding single/double quotes if present.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

try {
  // Prefer dotenv if installed, fall back to manual parse.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require("dotenv");
  if (dotenv && typeof dotenv.config === "function") {
    dotenv.config({ path: ENV_FILE });
  } else {
    loadEnvFile(ENV_FILE);
  }
} catch {
  loadEnvFile(ENV_FILE);
}

// ---------------------------------------------------------------------------
// Logging — to ~/.local/state/css/digest.log.
// ---------------------------------------------------------------------------

const LOG_DIR = resolve(HOME, ".local/state/css");
const LOG_FILE = resolve(LOG_DIR, "digest.log");

try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // ignore — logging failures must not crash the worker.
}

/**
 * Writes one line to digest.log and one to stdout — which must land in
 * *different* files. The launchd plists therefore must NOT redirect stdout
 * into digest.log: doing so gives every event two byte-identical entries in
 * the same file (which is what happened until 2026-08-06 — ~450 KB of the
 * 904 KB log was duplicate, and any `grep -c` over it read 2x high).
 * stdout goes to the plists' StandardOutPath, which is the right place for
 * crashes that bypass this function (tsx resolution errors, stack traces).
 */
function log(fields: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const payload = JSON.stringify({ ts, ...fields });
  console.log(payload);
  try {
    appendFileSync(LOG_FILE, payload + "\n");
  } catch {
    // ignore
  }
}

/**
 * Drizzle wraps the driver error so `err.message` is just the SQL text; the
 * real reason (ECONNREFUSED, connect timeout, Neon wake) lives in `err.cause`.
 * Surface it so the logs explain *why* a query failed, not just which one.
 */
function causeOf(err: unknown): string | undefined {
  const cause = (err as { cause?: unknown })?.cause;
  if (cause == null) return undefined;
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Retry a thenable with exponential backoff. Used to absorb the rare
 * Neon-connect / transient Postgres flake — the failure mode that took out
 * the 2026-05-14 09:02 PDT run, where all 14 ranges errored within 600 ms
 * because the first connection attempt failed and there was no retry.
 *
 * Defaults: 4 attempts at 500 ms → 2 s → 8 s back-off (10.5 s total ceiling).
 * NOTE: the loop skips the sleep on the final attempt, so reaching the full
 * 8 s back-off needs 4 attempts, not 3 — the 2026-06-03 run gave up after
 * only ~2.5 s (the old default of 3) and lost two ranges to a Neon cold start.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    baseMs?: number;
    factor?: number;
    // Return false to give up immediately on an error the back-off can't fix
    // (e.g. a logged-out CLI — see invokeClaude). Retryable by default.
    shouldRetry?: (err: unknown) => boolean;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 500;
  const factor = opts.factor ?? 4;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      if (opts.shouldRetry && !opts.shouldRetry(err)) {
        log({
          level: "warn",
          event: "retry_abort",
          label,
          attempt: i + 1,
          err: err instanceof Error ? err.message : String(err),
          cause: causeOf(err),
        });
        break;
      }
      const delay = baseMs * Math.pow(factor, i);
      log({
        level: "warn",
        event: "retry",
        label,
        attempt: i + 1,
        delayMs: delay,
        err: err instanceof Error ? err.message : String(err),
        cause: causeOf(err),
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Wake the Neon compute once, before the range loop, so the scale-to-zero
 * cold start (~9–10 s) is paid a single time instead of being charged against
 * the first one or two ranges' retry budgets (which is how 2026-06-03 lost the
 * June 2 daily).
 *
 * Hard-capped at WARM_UP_BUDGET_MS. The original version claimed a "~40 s"
 * budget but actually allowed 6 attempts at base 500 ms × factor 4 — that is
 * 170 s of *sleep* alone, and each attempt can additionally hang on the
 * driver's connect timeout. The 2026-08-06 run spent 606 s here before doing
 * any work. The retry params below sum to ~20 s of back-off; the deadline
 * bounds the pathological case where individual attempts hang.
 */
const WARM_UP_BUDGET_MS = 60_000;

// The daily/weekly/monthly agents all append to the same digest.log and all
// fire together on RunAtLoad, so tag warm-up events with the period — two
// concurrent runs otherwise emit byte-identical lines that read as a dupe.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function warmUpDb(db: any, period: Period): Promise<void> {
  const { sql } = await import("drizzle-orm");
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`warm-up exceeded ${WARM_UP_BUDGET_MS} ms budget`)),
      WARM_UP_BUDGET_MS,
    );
  });
  // 5 attempts at 500 ms × 3 → 500 + 1500 + 4500 + 13500 ≈ 20 s of back-off.
  const warm = withRetry("warmUp", () => db.execute(sql`select 1`), {
    attempts: 5,
    factor: 3,
  });
  // If the deadline wins the race, `warm` may still reject later with nobody
  // listening — attach a sink so that can't become an unhandled rejection.
  warm.catch(() => {});
  try {
    await Promise.race([warm, deadline]);
    log({ level: "info", event: "db_warm", period, elapsedMs: Date.now() - t0 });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// CLI args.
// ---------------------------------------------------------------------------

type Period = "day" | "week" | "month";

interface Args {
  period: Period;
  date?: string; // YYYY-MM-DD anchoring the period
  catchUp: boolean;
}

function parseArgs(argv: string[]): Args {
  let period: Period | undefined;
  let date: string | undefined;
  let catchUp = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--period") {
      const next = argv[++i];
      if (next === "day" || next === "daily") period = "day";
      else if (next === "week" || next === "weekly") period = "week";
      else if (next === "month" || next === "monthly") period = "month";
      else throw new Error(`Unknown --period value: ${next}`);
    } else if (a === "--date") {
      date = argv[++i];
    } else if (a === "--catch-up" || a === "--catchup") {
      catchUp = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: tsx scripts/run-digest.ts --period day|week|month [--date YYYY-MM-DD] [--catch-up]",
      );
      process.exit(0);
    }
  }
  if (!period) throw new Error("--period is required (day|week|month)");
  return { period, date, catchUp };
}

// ---------------------------------------------------------------------------
// Period math — all timestamps are UTC for stability.
// ---------------------------------------------------------------------------

interface PeriodRange {
  periodStart: Date;
  periodEnd: Date; // exclusive
}

function startOfUTCDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function startOfISOWeek(d: Date): Date {
  // Monday is day 1 in ISO; getUTCDay returns 0=Sun..6=Sat.
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(startOfUTCDay(d), diff);
}

function startOfUTCMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function rangeFor(period: Period, anchor: Date): PeriodRange {
  if (period === "day") {
    const start = startOfUTCDay(anchor);
    return { periodStart: start, periodEnd: addDays(start, 1) };
  }
  if (period === "week") {
    const start = startOfISOWeek(anchor);
    return { periodStart: start, periodEnd: addDays(start, 7) };
  }
  const start = startOfUTCMonth(anchor);
  return { periodStart: start, periodEnd: addMonths(start, 1) };
}

function defaultAnchor(period: Period, now: Date): Date {
  // "The most recent complete period ending before now."
  if (period === "day") return addDays(startOfUTCDay(now), -1);
  if (period === "week") return addDays(startOfISOWeek(now), -7);
  return addMonths(startOfUTCMonth(now), -1);
}

function parseDateArg(s: string): Date {
  // Accept YYYY-MM-DD; interpret as UTC midnight.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`--date must be YYYY-MM-DD, got: ${s}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

function periodsForCatchUp(period: Period, now: Date): PeriodRange[] {
  const out: PeriodRange[] = [];
  if (period === "day") {
    // Last 14 complete days.
    for (let i = 1; i <= 14; i++) {
      out.push(rangeFor("day", addDays(now, -i)));
    }
  } else if (period === "week") {
    // Last 8 complete ISO weeks.
    const thisWeekStart = startOfISOWeek(now);
    for (let i = 1; i <= 8; i++) {
      out.push(rangeFor("week", addDays(thisWeekStart, -7 * i)));
    }
  } else {
    // Last 3 complete months.
    const thisMonthStart = startOfUTCMonth(now);
    for (let i = 1; i <= 3; i++) {
      out.push(rangeFor("month", addMonths(thisMonthStart, -i)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DB — import drizzle setup from src.
// ---------------------------------------------------------------------------

// Resolve relative to this file so launchd's `cd` quirks don't break imports.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// Dynamic import after env is loaded so DATABASE_URL is available.
async function loadDb() {
  const dbMod = await import(resolve(REPO_ROOT, "src/db/index.ts"));
  return { db: dbMod.db, schema: dbMod.schema };
}

// ---------------------------------------------------------------------------
// Item query + prompt building.
// ---------------------------------------------------------------------------

interface DigestItem {
  id: number;
  title: string;
  url: string;
  source: string;
  oneLine: string;
  priority: "breaking" | "notable" | "routine";
  publishedAt: Date;
}

interface InsiderTransaction {
  date: string; // YYYY-MM-DD
  reporter: string;
  role: string | null;
  direction: "purchase" | "sale" | "other";
  shares: number;
  value: number | null;
  url: string;
}

const ITEM_CAP = 150;

async function fetchItemsForPeriod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  range: PeriodRange,
): Promise<DigestItem[]> {
  const { items, itemClassifications, sources } = schema;
  // Drizzle imports — use sql ops via drizzle-orm.
  const drizzleOrm = await import("drizzle-orm");
  const { and, gte, lt, sql: dsql, eq, desc } = drizzleOrm;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withRetry<any[]>("fetchItemsForPeriod", () =>
    db
      .select({
        id: items.id,
        title: items.title,
        url: items.url,
        sourceName: sources.name,
        oneLine: itemClassifications.oneLine,
        priority: itemClassifications.priority,
        relevance: itemClassifications.relevance,
        publishedAt: items.publishedAt,
      })
      .from(items)
      .innerJoin(itemClassifications, eq(itemClassifications.itemId, items.id))
      .innerJoin(sources, eq(sources.id, items.sourceId))
      .where(
        and(
          gte(items.publishedAt, range.periodStart),
          lt(items.publishedAt, range.periodEnd),
          // relevance >= 0.4 (column is numeric → text cast or just compare as string-safe via sql)
          dsql`${itemClassifications.relevance} >= 0.4`,
        ),
      )
      // Order: priority (breaking > notable > routine), then published_at desc.
      .orderBy(
        dsql`case ${itemClassifications.priority}
                when 'breaking' then 0
                when 'notable' then 1
                else 2
              end`,
        desc(items.publishedAt),
      )
      .limit(ITEM_CAP),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    source: r.sourceName,
    oneLine: r.oneLine,
    priority: r.priority,
    publishedAt: new Date(r.publishedAt),
  }));
}

/**
 * Pull Form 4 insider transactions enriched by the Form 4 XML parser. Returns
 * one row per filing with the dominant direction (purchase/sale/other) and
 * aggregate shares/value. Used to construct the prompt's investor preamble.
 */
async function fetchInsiderForPeriod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  range: PeriodRange,
): Promise<InsiderTransaction[]> {
  const { items, sources } = schema;
  const drizzleOrm = await import("drizzle-orm");
  const { and, eq, gte, lt, sql: dsql, desc } = drizzleOrm;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withRetry<any[]>("fetchInsiderForPeriod", () =>
    db
      .select({
        url: items.url,
        publishedAt: items.publishedAt,
        raw: items.rawJson,
      })
      .from(items)
      .innerJoin(sources, eq(sources.id, items.sourceId))
      .where(
        and(
          eq(sources.kind, "sec"),
          dsql`${items.rawJson}->>'filing_type' in ('4', '4/A')`,
          gte(items.publishedAt, range.periodStart),
          lt(items.publishedAt, range.periodEnd),
        ),
      )
      .orderBy(desc(items.publishedAt)),
  );

  return rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any): InsiderTransaction | null => {
      const raw = (r.raw ?? {}) as Record<string, unknown>;
      const reporter = (raw.reporter_name as string | undefined) ?? null;
      const dir = raw.transaction;
      const sharesRaw = typeof raw.shares === "number" ? raw.shares : Number(raw.shares);
      const valueRaw = typeof raw.value === "number" ? raw.value : Number(raw.value);
      if (!reporter || (dir !== "purchase" && dir !== "sale" && dir !== "other")) return null;
      if (!Number.isFinite(sharesRaw) || sharesRaw === 0) return null;
      return {
        date: new Date(r.publishedAt).toISOString().slice(0, 10),
        reporter,
        role: (raw.reporter_role as string | undefined) ?? null,
        direction: dir as "purchase" | "sale" | "other",
        shares: Math.abs(sharesRaw),
        value: Number.isFinite(valueRaw) ? valueRaw : null,
        url: r.url,
      };
    })
    .filter((x: InsiderTransaction | null): x is InsiderTransaction => x !== null);
}

function buildPrompt(
  period: Period,
  range: PeriodRange,
  items: DigestItem[],
  insider: InsiderTransaction[],
): string {
  const grouped: Record<DigestItem["priority"], DigestItem[]> = {
    breaking: [],
    notable: [],
    routine: [],
  };
  for (const it of items) grouped[it.priority]?.push(it);

  const fmt = (it: DigestItem) =>
    `- [${it.title}](${it.url}) — *${it.source}* — ${it.oneLine}`;

  const sections: string[] = [];
  if (grouped.breaking.length) {
    sections.push(`### Breaking items\n${grouped.breaking.map(fmt).join("\n")}`);
  }
  if (grouped.notable.length) {
    sections.push(`### Notable items\n${grouped.notable.map(fmt).join("\n")}`);
  }
  if (grouped.routine.length) {
    sections.push(`### Routine items\n${grouped.routine.map(fmt).join("\n")}`);
  }
  const itemsBlock = sections.length ? sections.join("\n\n") : "_(no qualifying items)_";

  // Structured insider preamble — gives Opus concrete numbers to cite in the
  // Investor highlights section. Aggregated by reporter so a single multi-row
  // filing reads as one transaction.
  const fmtUsd = (v: number | null) =>
    v == null ? "—" : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(1)}k` : `$${v}`;
  const insiderBlock = insider.length
    ? insider
        .map(
          (t) =>
            `- ${t.date} · ${t.reporter}${t.role ? ` (${t.role})` : ""} · ${t.direction} ${t.shares.toLocaleString()} sh · ${fmtUsd(t.value)} · ${t.url}`,
        )
        .join("\n")
    : "_(no Form 4 filings this period)_";

  const periodLabel =
    period === "day" ? "daily" : period === "week" ? "weekly" : "monthly";
  const startStr = range.periodStart.toISOString().slice(0, 10);
  const endStr = new Date(range.periodEnd.getTime() - 1).toISOString().slice(0, 10);

  return [
    `You are writing a ${periodLabel} digest about Figma (the company / FIG ticker) for a single technical reader who also tracks the stock as an investor.`,
    `Period: ${startStr} → ${endStr} (UTC, end inclusive). Total items: ${items.length}. Form 4 filings: ${insider.length}.`,
    ``,
    `Below are the items already classified for relevance and priority, plus a structured list of insider transactions parsed from Form 4 XML. Synthesize them — group related items, surface the actual story, name names, include numbers (share counts, prices, dates).`,
    ``,
    `Output **Markdown only** with exactly these five H2 sections, in this order:`,
    ``,
    `## Breaking`,
    `## Notable`,
    `## Investor highlights`,
    `## Routine`,
    `## What to watch`,
    ``,
    `Rules:`,
    `- Each section is 1–6 short bullets. "Breaking" may be empty (write "_None._").`,
    `- "Investor highlights" covers signal a FIG shareholder cares about: SEC filings (10-K/10-Q/8-K/S-1), insider buying/selling from Form 4s, material analyst rating changes, financial guidance, stock-affecting events. Cite specific share counts and dollar values from the Form 4 list below — do not round aggressively. If the period has nothing investor-relevant, write "_None._".`,
    `- "What to watch" forecasts the next ${periodLabel === "daily" ? "few days" : periodLabel === "weekly" ? "weeks" : "months"} based on what's in the items (no speculation beyond that).`,
    `- Cite items inline like [TechCrunch](url) — the URLs are already in the list below.`,
    `- Do NOT preface with "Here is the digest" or similar. Start directly with \`## Breaking\`.`,
    `- Do NOT invent items, transactions, or facts not present below.`,
    ``,
    `Insider transactions (Form 4):`,
    ``,
    insiderBlock,
    ``,
    `Items:`,
    ``,
    itemsBlock,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Invoke claude --print.
// ---------------------------------------------------------------------------

// Opus on the Max plan since digests are batched (low call volume) and
// quality matters more than speed. Costs the same Max-plan capacity.
const CLAUDE_MODEL = "claude-opus-4-7";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

interface ClaudeResult {
  text: string;
  modelLabel: string;
}

/**
 * A logged-out CLI is a permanent failure for the run, not a transient
 * hiccup — no amount of back-off re-authenticates it. Both the 2026-07-01
 * daily and monthly digests were lost this way, each burning ~30 min of retry
 * budget on a wall that never moves. Detect the signature so callers fail fast
 * and the alert can say "run /login". (notifyDigestFailure mirrors this regex
 * for its email copy.)
 *
 * The CLI phrases logout two ways depending on version/state:
 *   - older / never-logged-in: "Not logged in · Please run /login"
 *   - v2.x expired token:      "Failed to authenticate: OAuth session expired
 *                               and could not be refreshed"
 * The 2026-07-10→11 outage was the second phrasing: the old regex missed it,
 * so fail-fast never fired and each nightly run burned ~2h retrying an
 * unrecoverable auth wall before the alert surfaced. Match both.
 */
function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not logged in|please run \/login|failed to authenticate|oauth session expired|could not be refreshed/i.test(
    msg,
  );
}

async function invokeClaudeOnce(
  prompt: string,
  opts: { allowTextFallback: boolean },
): Promise<ClaudeResult> {
  // We try JSON output first; if the CLI version doesn't support it we fall
  // back to plain text. The current Claude Code CLI (verified via `claude
  // --help`) supports --print, --output-format json, and --model, so the JSON
  // path is preferred.
  try {
    const json = await runClaudeJson(prompt);
    return {
      text: json,
      modelLabel: `${CLAUDE_MODEL} (via Claude Code)`,
    };
  } catch (err) {
    // A logged-out CLI fails the text path identically — skip the second
    // invocation and propagate so invokeClaude's shouldRetry aborts the run.
    if (isAuthError(err)) throw err;
    // Transient JSON failures ("API Error: Connection closed mid-response",
    // which is a *streaming* blip, not a capability gap) used to drop straight
    // into the text path. That burned a second full invocation immediately and
    // silently downgraded the run: every digest from 2026-08-05 onward was
    // recorded as "text fallback" even though a retried JSON call would have
    // succeeded. Re-throw so withRetry backs off and retries JSON; only the
    // last attempt is allowed to degrade, so a genuinely JSON-less CLI still
    // produces a digest rather than nothing.
    if (!opts.allowTextFallback) {
      log({ level: "warn", event: "claude_json_failed", willRetryJson: true, err: String(err) });
      throw err;
    }
    log({ level: "warn", event: "claude_json_failed", willRetryJson: false, err: String(err) });
    const text = await runClaudeText(prompt);
    return {
      text,
      modelLabel: `${CLAUDE_MODEL} (via Claude Code, text fallback)`,
    };
  }
}

/**
 * Wrap the json→text invocation in withRetry. The 2026-05-19 incident showed
 * the CLI can exit 1 with empty stderr on a transient Max-plan limit / backend
 * hiccup, and the json attempt plus its immediate text fallback hit the same
 * wall back-to-back (~27 min burned, the day's digest permanently dropped
 * until the next nightly catch-up). A spaced retry gives the limit time to
 * clear. Each failing CLI attempt already costs minutes, so the back-off is
 * effectively free relative to the work it guards.
 *
 * The 2026-05-24 catch-up failure ran the original 30s/120s plan to
 * exhaustion on all three missing periods — the dip was wider than the
 * retry window. Bumped to 60s/300s/1500s (~30 min worst case per period)
 * so the next wide dip is more likely to clear before we give up.
 */
async function invokeClaude(prompt: string): Promise<ClaudeResult> {
  const attempts = 3;
  let attempt = 0;
  return withRetry(
    "invokeClaude",
    () => {
      attempt += 1;
      // Degrade to the text path only once the JSON retries are exhausted.
      return invokeClaudeOnce(prompt, { allowTextFallback: attempt >= attempts });
    },
    {
      attempts,
      baseMs: 60_000,
      factor: 5,
      // A logged-out CLI won't recover mid-run — fail fast instead of burning
      // ~30 min (60s/300s/1500s) of back-off, and let the alert surface it.
      shouldRetry: (err) => !isAuthError(err),
    },
  );
}

function runClaudeOnce(args: string[], prompt: string): Promise<string> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", rejectFn);
    child.on("close", (code) => {
      if (code === 0) {
        resolveFn(stdout);
        return;
      }
      // 2026-05-24: tightened the error message after a day of failures
      // logged just `claude exited 1: ` with no other context. We now keep
      // the full stderr (no slice) and, when it's empty, fall back to a
      // stdout summary (length + tail) — the most likely place the CLI
      // leaves a clue when it prints a partial result before crashing.
      const diag = stderr.length
        ? `stderr=${stderr}`
        : `stderr empty; stdout_len=${stdout.length} stdout_tail=${JSON.stringify(stdout.slice(-200))}`;
      rejectFn(new Error(`claude exited ${code}: ${diag}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function runClaudeJson(prompt: string): Promise<string> {
  const raw = await runClaudeOnce(
    ["--print", "--output-format", "json", "--model", CLAUDE_MODEL],
    prompt,
  );
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed.result === "string") return parsed.result;
  if (parsed && parsed.is_error) {
    throw new Error(`claude json is_error: ${parsed.api_error_status ?? "unknown"}`);
  }
  throw new Error("claude JSON missing .result field");
}

async function runClaudeText(prompt: string): Promise<string> {
  return runClaudeOnce(["--print", "--model", CLAUDE_MODEL], prompt);
}

function validateDigest(md: string): boolean {
  const headings = [
    "## Breaking",
    "## Notable",
    "## Investor highlights",
    "## Routine",
    "## What to watch",
  ];
  return headings.some((h) => md.includes(h));
}

// ---------------------------------------------------------------------------
// DB write + webhook ping.
// ---------------------------------------------------------------------------

async function digestExists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  period: Period,
  range: PeriodRange,
): Promise<boolean> {
  const { digests } = schema;
  const { and, eq } = await import("drizzle-orm");
  const rows = await withRetry<Array<{ id: number }>>("digestExists", () =>
    db
      .select({ id: digests.id })
      .from(digests)
      .where(and(eq(digests.period, period), eq(digests.periodStart, range.periodStart)))
      .limit(1),
  );
  return rows.length > 0;
}

async function insertDigest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  row: {
    period: Period;
    periodStart: Date;
    periodEnd: Date;
    summaryMd: string;
    itemIds: number[];
    model: string;
  },
): Promise<number | null> {
  const { digests } = schema;
  const inserted = await withRetry<Array<{ id: number }>>("insertDigest", () =>
    db
      .insert(digests)
      .values({
        period: row.period,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        summaryMd: row.summaryMd,
        itemIds: row.itemIds,
        model: row.model,
      })
      .onConflictDoNothing({ target: [digests.period, digests.periodStart] })
      .returning({ id: digests.id }),
  );
  return inserted[0]?.id ?? null;
}

async function pingWebhook(digestId: number): Promise<void> {
  const appUrl = process.env.APP_URL;
  const secret = process.env.DIGEST_WEBHOOK_SECRET;
  if (!appUrl || !secret) {
    log({ level: "warn", event: "webhook_skipped", reason: "missing APP_URL or DIGEST_WEBHOOK_SECRET" });
    return;
  }
  try {
    const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/webhooks/digest-published`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ digestId, secret }),
    });
    log({
      level: res.ok ? "info" : "warn",
      event: "webhook_posted",
      digestId,
      status: res.status,
    });
  } catch (err) {
    log({ level: "warn", event: "webhook_failed", digestId, err: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Main per-period flow.
// ---------------------------------------------------------------------------

type GenerateStatus =
  | { kind: "written" }
  | { kind: "skip_exists" }
  | { kind: "skip_no_items" }
  | { kind: "failed"; err: string };

async function generateOne(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  period: Period,
  range: PeriodRange,
): Promise<GenerateStatus> {
  const startStr = range.periodStart.toISOString();
  const endStr = range.periodEnd.toISOString();
  try {
    if (await digestExists(db, schema, period, range)) {
      log({ level: "info", event: "skip_exists", period, periodStart: startStr });
      return { kind: "skip_exists" };
    }

    const [items, insider] = await Promise.all([
      fetchItemsForPeriod(db, schema, range),
      fetchInsiderForPeriod(db, schema, range),
    ]);
    if (items.length === 0 && insider.length === 0) {
      log({
        level: "info",
        event: "skip_no_items",
        period,
        periodStart: startStr,
        periodEnd: endStr,
      });
      return { kind: "skip_no_items" };
    }

    const prompt = buildPrompt(period, range, items, insider);
    const { text, modelLabel } = await invokeClaude(prompt);

    if (!validateDigest(text)) {
      log({
        level: "warn",
        event: "digest_missing_sections",
        period,
        periodStart: startStr,
        chars: text.length,
      });
    }

    const id = await insertDigest(db, schema, {
      period,
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      summaryMd: text,
      itemIds: items.map((i) => i.id),
      model: modelLabel,
    });

    log({
      level: "info",
      event: "digest_written",
      period,
      periodStart: startStr,
      periodEnd: endStr,
      itemCount: items.length,
      digestId: id,
      model: modelLabel,
      status: "ok",
    });

    if (id !== null) await pingWebhook(id);
    return { kind: "written" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({
      level: "error",
      event: "digest_failed",
      period,
      periodStart: startStr,
      err: message,
      cause: causeOf(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { kind: "failed", err: message };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    log({ level: "error", event: "missing_database_url", envFile: ENV_FILE });
    process.exit(1);
  }

  const { db, schema } = await loadDb();

  // Pay the Neon cold start once, up front. Without this the first range's
  // ~10.5 s retry budget gets spent waking the compute and the range is lost
  // (the 2026-06-03 09:06 PDT run dropped the June 2 daily this way).
  // A failed warm-up is not fatal: it is an optimisation, and every query
  // below carries its own retry budget. Exiting here (the previous behaviour)
  // threw away the whole run over a slow wake that the range loop would have
  // absorbed on its own.
  try {
    await warmUpDb(db, args.period);
  } catch (err) {
    log({
      level: "warn",
      event: "db_warm_failed",
      period: args.period,
      note: "continuing — per-range retries will absorb the cold start",
      err: err instanceof Error ? err.message : String(err),
      cause: causeOf(err),
    });
  }

  const now = new Date();

  let ranges: PeriodRange[];
  if (args.catchUp) {
    ranges = periodsForCatchUp(args.period, now);
  } else {
    const anchor = args.date ? parseDateArg(args.date) : defaultAnchor(args.period, now);
    ranges = [rangeFor(args.period, anchor)];
  }

  log({
    level: "info",
    event: "run_start",
    period: args.period,
    catchUp: args.catchUp,
    ranges: ranges.map((r) => ({
      start: r.periodStart.toISOString(),
      end: r.periodEnd.toISOString(),
    })),
  });

  let written = 0;
  let skipExists = 0;
  let skipNoItems = 0;
  let failed = 0;
  let firstError: string | null = null;
  const failedPeriods: string[] = [];
  for (const range of ranges) {
    const s = await generateOne(db, schema, args.period, range);
    if (s.kind === "written") written += 1;
    else if (s.kind === "skip_exists") skipExists += 1;
    else if (s.kind === "skip_no_items") skipNoItems += 1;
    else {
      failed += 1;
      failedPeriods.push(range.periodStart.toISOString().slice(0, 10));
      if (firstError === null) firstError = s.err;
    }
  }

  log({
    level: "info",
    event: "run_end",
    period: args.period,
    totals: { ranges: ranges.length, written, skipExists, skipNoItems, failed },
  });

  // Alert when the run produced zero new digests but at least one range
  // errored. Catches the 2026-05-14 morning incident pattern (all ranges
  // failed at first-connection time, run exited 0, user discovered hours
  // later). Successful skip_exists / skip_no_items days don't trigger.
  if (failed > 0 && written === 0) {
    try {
      const notifyMod = await import(resolve(REPO_ROOT, "src/notify/index.ts"));
      const { sent, channels } = await notifyMod.notifyDigestFailure({
        period: args.period,
        totalRanges: ranges.length,
        failedRanges: failed,
        written,
        skipExists,
        skipNoItems,
        failedPeriods,
        sampleError: firstError,
      });
      log({
        level: sent > 0 ? "info" : "warn",
        event: sent > 0 ? "failure_alert_sent" : "failure_alert_no_recipients",
        period: args.period,
        failed,
        total: ranges.length,
        channels,
        sent,
      });
    } catch (err) {
      log({
        level: "warn",
        event: "failure_alert_skipped",
        period: args.period,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log({
      level: "error",
      event: "fatal",
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  });
