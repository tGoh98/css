# Architecture — Claudy Simple Server (CSS)

Personal web app for aggregating, classifying, and summarizing Figma-related signal from news, SEC filings, Figma's own channels, community sources, and competitors. The name is a backronym — the repo already lived at `playground/css`.

## Goals & non-goals

**Goals**
- Single place to track everything published about Figma the company
- Scheduled AI digests (daily / weekly / monthly) and a per-item breaking-news flag
- Multi-tab UI separating different kinds of signal (general feed, official, watchlist, competitors)
- Low-friction personal use: push notifications, search, bookmarks

**Non-goals (for v1)**
- Public-facing product or SEO
- Full text of paywalled sources (WSJ, Barron's, proprietary analyst reports) — we accept headlines + snippets
- Real-time multi-user collaboration (single user / small group, light auth)
- Interactive AI: no chat over the corpus and no on-demand per-item summaries. AI runs at ingest (cheap, batched) and on a schedule (digests). Everything else is plain queries.

## UI

### Tabs

1. **Feed** — paginated chronological list of every item across every source. Filterable by source, priority, and time range. Full-text search via the ⌘K palette. Routine competitor chatter is suppressed by default (competitor sources must hit `notable+` to appear); core sources unaffected.
2. **Digests** — scheduled AI summaries (daily / weekly / monthly), paginated newest-first. Each digest has five fixed H2 sections: `## Breaking`, `## Notable`, `## Investor highlights`, `## Routine`, `## What to watch`. The Investor highlights section is fed a structured Form 4 preamble so Opus can cite specific share counts / dollar values.
3. **Official** — SEC filings + Figma's own blog/press releases (paginated). FIG ticker chart pinned at top with news/filings overlaid as event markers; range tabs (1W / 1M / 6M / 1Y / 5Y) slice the cached data client-side. Hover/tap a marker for date + source + classifier one-line + priority. Chart data is cached daily-close — disclaimer surfaces last poll time. **Insider Activity** widget below the chart summarizes the last ~10 Form 4s (reporter, role, direction, shares, dollar value).
4. **Analyst** — Finnhub free-tier data for FIG: live quote + next-earnings card, current-month consensus with shift-vs-prior-month annotation, 24-month stacked recommendation trend, and earnings beat/miss surprise table. Premium Finnhub endpoints (per-analyst upgrade/downgrade history, price-target detail, estimate revisions) are paywalled and intentionally out of scope.
5. **Competitors** — Adobe, Canva, Sketch, Penpot, plus AI design challengers. Same shape as Feed but scoped.
6. **About** — what CSS is, where signal comes from, how the AI works, plus a prominent "not investment advice / vibe-coded / hallucinations possible" disclaimer.

### Cross-cutting

- **Public read-only site, admin-gated writes.** All content tabs are public; only `/admin/*` requires GitHub sign-in (`AUTH_ADMIN` env or first entry of `AUTH_ALLOWLIST`). Server actions are wrapped in `requireAdmin()` as defense in depth.
- **Search** — ⌘K palette + a search bar on Feed. Postgres full-text search over title + snippet + full_text + classifier `one_line`. Public endpoint, 200-char query cap.
- **Topic clustering / dedup** — items grouped by Haiku into clusters; the Feed collapses N near-duplicates into a single card with a "+N similar" badge. The badge links to `/cluster/[id]`, a drill-in page listing every member of the cluster (most-recent first).
- **Push notifications** — email via Resend. `notifyBreaking()` fires on insert of priority=breaking (skipping `backfilled=true` items so historical loads don't page). `notifyDigest()` fires from the digest webhook after each new `digests` row.

### Per-item behavior

- Title, source badge, published date, classifier `one_line` (one-sentence AI blurb generated at ingest), priority badge (breaking/notable/routine), cluster badge if applicable.
- Click → detail view with the full snippet/text (no on-demand AI call) + link to the source.

## Architecture

```
                ┌──────────────────────────────────┐
GH Actions    ─►│ Ingest workers (one per source)  │
(15m + hourly)  │ news / SEC / Figma blog / reddit │
                │ HN / competitors / chart         │
                └──────────────┬───────────────────┘
                               │ for each new item:
                               │   1. dedup by (source_id, external_id)
                               │   2. Haiku classifier (relevance + priority + one_line) — API, batched
                               │   3. drop if relevance < 0.5
                               │   4. for Form 4s: fetch + parse XML, enrich raw_json
                               │   5. assign to topic cluster
                               │   6. insert
                               │   7. if priority='breaking' AND !backfilled → notify
                               ▼
                ┌──────────────────────────────────┐
                │ Neon Postgres                    │
                │ items, sources, classifications, │
                │ digests, clusters, chart_points, │
                │ notification_channels, sent      │
                └─────┬───────────────┬────────────┘
                      │               │
                      │               ▼
                      │  ┌──────────────────────────┐
                      │  │ Notifier (Vercel Function)│
                      │  │ email via Resend          │
                      │  └──────────────────────────┘
                      │
                      │  ┌──────────────────────────────────┐
                      │  │ Local digest worker (user's Mac) │
                      │  │ launchd → `claude --print`        │
                      │  │ Opus 4.7 via Max plan             │
                      │  │ batches: daily/weekly/monthly     │
                      │  │ pulls items + Form 4 transactions │
                      │  │ writes summary_md back to Neon    │
                      │  │ posts to /api/webhooks/digest-... │
                      │  └──────────────────────────────────┘
                      ▼
                ┌──────────────────────────────────┐
                │ Next.js app on Vercel            │
                │ Feed / Digests / Official /      │
                │ Analyst / Competitors / About    │
                │ (+ Search, ⌘K, /admin/*)         │
                └──────────────────────────────────┘
```

## Data model

```
sources
  id, name, kind ('news'|'sec'|'blog'|'reddit'|'hn'|'competitor-news'|'competitor-blog'),
  category ('core'|'competitor'),
  config_json, enabled, last_polled_at

items
  id, source_id, external_id, url, title, snippet, full_text, author,
  published_at, fetched_at, raw_json,
  cluster_id nullable, backfilled bool default false
  unique(source_id, external_id)

item_classifications
  item_id pk, relevance numeric, priority ('routine'|'notable'|'breaking'),
  one_line text, classifier_model, classified_at

item_clusters
  id, representative_title, item_count, first_seen_at, last_seen_at

digests
  id, period ('day'|'week'|'month'), period_start, period_end,
  summary_md, item_ids int[], model, generated_at
  unique(period, period_start)  -- catch-up logic uses this

chart_points
  symbol text, t timestamptz, close numeric(12,4), currency, fetched_at
  primary key (symbol, t)
  -- Daily closes cached hourly by the chart ingester. Yahoo aggressively
  -- rate-limits Vercel IPs; reading from this table at request time keeps
  -- /official snappy and resilient.

notification_channels
  id, kind ('email'|'slack'|'discord'), config_json, enabled

notifications_sent
  item_id, channel_id, sent_at  -- dedup so we don't notify twice

ai_usage
  id, job ('classify'|'cluster'), model, item_id nullable, source_kind nullable,
  input_tokens, cache_read_input_tokens, cache_write_input_tokens,
  output_tokens, created_at
  -- One row per Anthropic API call from the classifier/clusterer. Cost
  -- attribution: the billing CSV only splits by model+token_type+date and
  -- can't tell classify vs cluster apart. Best-effort write — a failure
  -- here never breaks ingest. (Batched classify calls log item_id/
  -- source_kind null since one call covers many mixed-source items.)

users
  id, email, github_id, github_username, created_at
  -- public site; only AUTH_ADMIN (or AUTH_ALLOWLIST[0]) sees /admin/*

-- Schema-present but unused in the current UI:
--   watchlists, bookmarks, item_notes  (left in case we revive saved-views)
```

Indexes: `items(published_at desc)`, `items(source_id, published_at desc)`, `items(cluster_id)`, `item_classifications(priority)`, GIN index on items full_text for FTS, `chart_points(symbol, t desc)`, `ai_usage(created_at desc)`, `ai_usage(job)`.

**Form 4 enrichment.** Items from SEC sources where `raw_json.filing_type IN ('4', '4/A')` carry parsed insider-transaction fields merged into `raw_json`: `reporter_name`, `reporter_role`, `is_officer/is_director/is_ten_percent_owner`, `transaction_code`, `transaction` ('purchase'|'sale'|'other'), `shares` (signed net), `value` (USD). Populated by `src/ingest/sec-form4.ts` (cheerio xmlMode parser) on first ingest; backfilled by `npm run backfill:sec-form4-enrich` for legacy rows.

## Sources

### Core (Figma)

| Source | API/feed | Polling | Backfill depth | Notes |
|---|---|---|---|---|
| Google News | RSS `news.google.com/rss/search?q=Figma` | 5 min | Recent only (~weeks) | Unofficial but reliable. Headlines + snippets across WSJ, Bloomberg, TechCrunch, The Verge, Barron's, etc. |
| SEC EDGAR | `data.sec.gov/submissions/CIK*.json` + filings index | hourly | Full history (since S-1, Apr 2025) | Free, no key. Pull 10-K, 10-Q, 8-K, S-1, Form 4. Form 4 powers Insider Activity widget. |
| Figma blog | RSS at `figma.com/blog/feed/` (or equivalent) | hourly | Last ~20 via RSS; full archive via scrape | |
| Reddit | `reddit.com/r/<sub>/search.rss?q=Figma&restrict_sr=on&sort=new` across r/FigmaDesign + design subs (UI_Design, userexperience, web_design, design) + financial subs (stocks, StockMarket, wallstreetbets, investing, ValueInvesting, SecurityAnalysis, IPO) | 5 min | Last ~few months via search | See **Reddit operational note** below — Pushshift dead. |
| Hacker News | Algolia `hn.algolia.com/api/v1/search_by_date?query=Figma` with watermarked `numericFilters=created_at_i>...` | 5 min | Full history (years) | Free, no key. Paginates 4 × 50 hits on backlog so spikes self-heal. |

### Competitor

| Source | API/feed | Polling | Notes |
|---|---|---|---|
| Adobe news | Google News RSS scoped to Adobe + Adobe newsroom RSS | hourly | High volume — relevance filter important |
| Canva news | Google News RSS scoped to Canva + Canva blog RSS | hourly | |
| Sketch | Sketch blog RSS | daily | Low volume |
| Penpot | Penpot blog RSS + GitHub releases | daily | Low volume; OSS so GH releases are signal |

### Analyst & market data

| Source | API/feed | Notes |
|---|---|---|
| Finnhub (free tier) | `/quote`, `/stock/recommendation`, `/stock/earnings`, `/calendar/earnings` for FIG | Powers the Analyst tab. Requires `FINNHUB_API_KEY`. Premium endpoints (`/stock/price-target`, `/stock/upgrade-downgrade`, estimate revisions) are paywalled and not used. |
| Yahoo Finance (chart) | `query1`/`query2 finance.yahoo.com/v8/finance/chart/FIG?range=1y&interval=1d` | Used by `src/ingest/chart.ts` to populate `chart_points` hourly. Rate-limits Vercel IPs aggressively — caching the response in Postgres is the whole point. |

## Operational notes

### Figma IR site is Cloudflare-gated; relying on SEC 8-K (2026-05-13)

**Investigated:** Whether a dedicated `ir-press` poller against `investor.figma.com` was worth building.

**Findings:**
- `investor.figma.com` is hosted on Q4 Inc. The site root (`/overview/default.aspx`) returns 200, but every press-release / news / SEC / events path returns a Cloudflare managed-challenge HTML interstitial regardless of UA or headers. No plain-`fetch()` client can reach the rendered content.
- The Q4 JSON syndication endpoint `/feed/PressRelease.svc/GetPressReleaseList` is *not* Cloudflare-blocked (200 OK), but returns `{"GetPressReleaseListResult":[]}` for every `serviceDto` variant tried — including correct `Year` values pulled from `GetPressReleaseYearList` (which itself returns `[2026, 2025, 2024]`). The same empty result reproduces on a peer Q4 site (`investor.redditinc.com`), so Q4 has restricted that endpoint platform-wide; it isn't Figma-specific. Likely requires a domain-scoped service key that's only present in the JS bundle's runtime config.
- Headless-browser scraping was rejected as over-engineering for a personal tool.

**Decision:** Skip the `ir-press` poller. The existing SEC EDGAR ingest captures every material press release Figma files (as 8-Ks, usually within hours of the wire). The trade-off is latency — a few hours behind Business Wire — which is acceptable for v1.

**If we change our minds later:** Figma distributes via Business Wire; `Figma site:businesswire.com` on Google News RSS returns the actual press releases and is parseable with the existing news-ingester pattern. That's the lowest-friction path back in.

### Reddit: data-center IP blocking (2026-05-14)

**Symptom:** All `/r/<sub>/search.json` requests from the Vercel cron route returned `403 Blocked`, even though the same URLs returned 200 with the same User-Agent from local curl. Reddit aggressively filters anonymous traffic from data-center IP ranges (AWS / Vercel) regardless of UA.

**Current mitigation (commit `8cd3b1f`):** `src/ingest/reddit.ts` polls `/search.rss` instead of `/search.json`. As of 2026-05-14 the RSS endpoint is *not* blocked from Vercel — a single live call returned 32 inserted / 74 skipped / 0 errors across all 12 configured subs.

**How to detect a recurrence:**
```bash
# 1. Hit the Vercel route directly:
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://css-lake-three.vercel.app/api/cron/ingest/reddit | jq .errors
# Look for "403 Blocked" / "429 Too Many Requests" / "fetch ... → 5xx" entries.

# 2. Verify local works (rules out a global Reddit outage):
curl -sI -H 'User-Agent: CSS-Aggregator timgoh98@gmail.com' \
  'https://www.reddit.com/r/FigmaDesign/search.rss?q=Figma&restrict_sr=on'
```

**Fallback escalation plan if RSS also gets blocked:**

1. **Local launchd ingest** (cheapest): mirror the digest-worker pattern — write `scripts/run-reddit.ts` that imports `src/ingest/reddit.ts`'s `ingest()` and runs it locally, write a `com.css.reddit-ingest.plist` that fires every 15 min from the user's Mac, and delete the `/api/cron/ingest/reddit` cron entry from the GH Actions matrix. Loses the "always-on" guarantee but the user already accepts that for digests.

2. **Authenticated Reddit OAuth** (most robust, more setup): create a Reddit app at `reddit.com/prefs/apps` → "script" type → grab `client_id` and `client_secret`. Add `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` to Vercel env. Switch the ingester to fetch a bearer token via `https://www.reddit.com/api/v1/access_token` and call the OAuth `oauth.reddit.com` endpoints. Authenticated traffic gets much higher rate limits and isn't IP-filtered the same way.

3. **Third-party Reddit search proxy**: Pushshift is dead. RedditWarp / async PRAW need OAuth anyway. There are some free mirrors (e.g. Reveddit) but none are production-grade.

If we ever hit fallback step 1, also update this note + bump the commit reference.

## AI usage

- **Ingest-time classifier (Anthropic API, Haiku 4.5).** `tool_use` with a forced schema. JSON per item: `{ relevance: 0–1, priority: routine|notable|breaking, one_line: string }`. Drop (delete the items row) if `relevance < 0.5`. Priority rubric biases toward 'routine' (default) — only true material events escalate to 'breaking'. Prompt includes an explicit security note instructing Haiku that the source/URL/title/snippet are untrusted third-party data and must not be followed as instructions, plus an isolation note so one item's text can't influence another's score in a batch. **Batched, not per-item:** `classifyItem` keeps a per-item signature but concurrent calls (pollers classify in concurrent chunks) are coalesced into one Haiku request, amortizing the ~1k-token system prompt across many items — the dominant cost. Failed/omitted items fall back to individual retries so a bad batch never loses classifications. No prompt caching: Haiku 4.5's cache floor is ~4096 tokens (empirically verified), well above this prompt, so `cache_control` would be a silent no-op — batching is the lever instead. ~$0.0001/item batched (was ~$0.0005 per-item).
- **Topic clustering (Anthropic API, Haiku 4.5).** Periodic job (every 30 min) re-clusters last-24h items by semantic similarity; picks a representative title. One call per run (all candidates in a single request); small cost. No `cache_control` — single call/run, nothing to reuse, and the prompt is below the cache floor anyway.
- **Cost attribution (`ai_usage` table).** Both Haiku consumers log per-call token usage (input / cache read / cache write / output) tagged with job, so spend can be split classify-vs-cluster and the real post-batching cost measured — the billing CSV can't do this.
- **Manual-upload doc extraction (local Claude Code CLI, Sonnet 4.6, Max plan).** `scripts/ingest-pdfs.ts` (run on the owner's Mac) spawns `claude --print --output-format json`; for **PDF** it adds `--allowedTools Read --permission-mode bypassPermissions` and Claude Code's Read tool renders pages visually + extracts text, for **Word .docx** it text-extracts with `mammoth` and inlines the text in the prompt (no tool needed). Emits the structured-fields JSON validated by the Zod schema in `src/ai/doc-extract.ts`. $0 marginal (Max plan). There is **no API path** — ingest is local-only; `/admin/upload` is now a read-only management view.
- **Scheduled digests (local Claude Code CLI, Opus 4.7, Max plan).** A `launchd` job on the user's Mac runs `scripts/run-digest.ts` daily / weekly / monthly. The script connects to Neon, pulls items for the period, **also pulls aggregated Form 4 transactions** for the same window, builds a structured prompt (item lists grouped by priority + a one-line-per-row insider-transaction preamble), invokes `claude --print --model claude-opus-4-7 --output-format json`, and writes `summary_md` back to `digests`. The prompt requires exactly five H2 sections: `## Breaking`, `## Notable`, `## Investor highlights`, `## Routine`, `## What to watch`. The Investor highlights section cites specific share counts and dollar values from the Form 4 preamble. After insert, the worker POSTs to `/api/webhooks/digest-published` with `DIGEST_WEBHOOK_SECRET` (constant-time compared) so the Vercel function can fan out via Resend. Catch-up: each run checks the recent window for missing digests and generates them — so a daily digest missed because the Mac was asleep at 09:00 gets generated whenever the Mac next runs the job. Cost: $0 marginal (uses Max plan capacity).

**Estimated monthly cost:** ~$1–2 API (classifier + clustering, post-batching; was $3–5 — classifier was ~75% of spend as uncached per-item Haiku calls) + $0 for digests and manual-upload extraction (both Max plan, local) + $0 for notifications (Resend free tier). Verify against `ai_usage` after a real ingest run.

## Scheduling

| Job | Cadence | Where | What |
|---|---|---|---|
| `ingest:news` | every 5 min | **GitHub Actions** cron | Google News RSS for Figma |
| `ingest:reddit` | every 5 min | **GitHub Actions** cron | Reddit RSS across configured subs (see Reddit op note) |
| `ingest:hn` | every 5 min | **GitHub Actions** cron | HN Algolia search (watermark + paginate) |
| `ingest:figma-blog` | hourly | **GitHub Actions** cron | Figma blog RSS |
| `ingest:sec` | hourly | **GitHub Actions** cron | EDGAR for new Figma filings (with Form 4 XML enrichment) |
| `ingest:competitors` | hourly | **GitHub Actions** cron | Adobe / Canva / Sketch / Penpot / AI challengers |
| `ingest:chart` | hourly | **GitHub Actions** cron | Yahoo daily-close fetch → upsert `chart_points` |
| `cluster:recent` | every 30 min | **GitHub Actions** cron | Re-cluster last-24h items |
| `notify:breaking` | event-driven | Vercel Function | On insert of priority=breaking (skipping `backfilled=true`), fan out to enabled channels |
| `digest:daily` | 09:00 daily | **launchd (user's Mac)** | Daily digest via local Claude Code (Opus 4.7) |
| `digest:weekly` | Mondays 09:00 | **launchd (user's Mac)** | Weekly digest |
| `digest:monthly` | 1st of month 09:00 | **launchd (user's Mac)** | Monthly digest |

Vercel Hobby caps cron at 2 daily-only jobs, so the ingest schedule lives in `.github/workflows/cron.yml` as two matrix jobs (`*/5 * * * *` and `0 * * * *`) that hit `/api/cron/ingest/*` with `Authorization: Bearer $CRON_SECRET`. The Vercel function handlers verify via `crypto.timingSafeEqual`. `vercel.json` still configures 2 daily cron entries as a fallback.

Each ingest also tracks per-tick **saturation** — if its `MAX_ITEMS_*` cap fills with all-new items in a single tick, it pushes a warning into the response that fails the GH Actions step (catch-all email) and triggers a Resend "saturation" email. HN additionally watermarks the newest seen `published_at` and paginates Algolia until caught up (up to 4 × 50 hits), so a backlog from a news spike self-heals on the next tick.

Local digest jobs use `StartCalendarInterval` + the script's catch-up logic so missed runs (Mac asleep, traveling, etc.) are picked up on next wake.

## Deployment

- **Web app:** Vercel (Next.js + serverless functions + Vercel Cron for ingest)
- **Database:** Neon Postgres (free tier). The `pgvector` extension is enabled but unused in v1 (kept available for a future "chat over corpus" feature if we add one).
- **Auth:** NextAuth + GitHub OAuth, allowlist via `AUTH_ALLOWLIST` env var (defaults to just the owner)
- **Digest worker:** runs on the owner's Mac. `scripts/run-digest.ts` is invoked by `~/Library/LaunchAgents/com.css.digest-daily.plist` (and `-weekly`, `-monthly`). Requires Claude Code CLI installed and authenticated on the Max plan.
- **Secrets (Vercel env vars):**
  - `DATABASE_URL` (Neon)
  - `ANTHROPIC_API_KEY` (classifier + clustering)
  - `FINNHUB_API_KEY` (Analyst tab)
  - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_TO_EMAIL`
  - `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
  - `AUTH_ALLOWLIST` (comma-separated GitHub usernames, e.g. `tGoh98`); `AUTH_ADMIN` (single username; defaults to allowlist[0])
  - `CRON_SECRET` (bearer token for `/api/cron/*`; constant-time compared)
  - `DIGEST_WEBHOOK_SECRET` (bearer for `/api/webhooks/digest-published`)
- **Secrets (GitHub Actions repo secrets):**
  - `CRON_SECRET` (must match the Vercel env var of the same name; drives the cron workflow)
- **Secrets (local, for digest worker):** all in `~/.config/css/digest.env` (outside the repo, mode 600):
  - `DATABASE_URL`, `APP_URL`, `DIGEST_WEBHOOK_SECRET`, `CLAUDE_BIN` (optional)
- **Cost:** $0 infra (Vercel + Neon + Resend free tiers), ~$1–2/mo Anthropic API (post-batching), $0 digests (Max plan)

## Backfill strategy

One-shot script per source: `npm run backfill:<source>`. Marks items with `backfilled = true`. Run once at project start, then normal cron takes over. Backfilled items go through the same classifier — relevance threshold handles noise.

- **SEC EDGAR** — walk filings index from Figma's CIK back to S-1 (Apr 2025). Form 4 XML is fetched + parsed inline so insider rows are usable immediately. Cheap, complete.
- **`backfill:sec-form4-enrich`** — one-shot SQL-normalize + Form 4 XML enrichment for legacy SEC rows whose `raw_json` was written by an earlier backfill (different key names, no insider details). Re-runnable, idempotent, polite to EDGAR (≤7 req/s).
- **Hacker News** — Algolia date-ranged search. Cheap, complete.
- **Figma blog** — scrape `/blog?page=N` paginated archive until exhausted; only items with a real `<time>` element are kept (filters out category index pages).
- **Reddit** — search RSS with date ranges; accept ~few months of depth.
- **Google News** — no historical backfill via free path. Live forward only.
- **Competitors** — same shape as primary news (recent-only for news; full for blogs). DB-driven config: `/admin/competitors` page edits the `sources` table directly.
- **Chart** — `npm exec tsx --env-file=.env.local src/ingest/chart.ts` (or just trigger the cron route) seeds `chart_points` with 1y of daily closes; subsequent hourly polls upsert.

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-05-13 | Project name: Claudy Simple Server (CSS) | User-chosen; backronym for the existing `playground/css` directory |
| 2026-05-13 | Stack: Next.js + TS + Postgres | Best DX for "small site + scheduled jobs + auth"; one repo, one language |
| 2026-05-13 | Hosting: Vercel + Neon, NextAuth + GitHub OAuth | Same cost as local; always-on cron, friends can see it, no machine-uptime worry |
| 2026-05-13 | Single Haiku call does relevance + priority + one-line together | One round-trip handles "is this actually Figma" and "is this breaking" |
| 2026-05-13 | News aggregator = Google News RSS for v1 | Free and broad. NewsAPI free tier too restricted; paid tier overkill. |
| 2026-05-13 | Core sources for v1: Google News, SEC EDGAR, Figma blog, Reddit, HN | User confirmed |
| 2026-05-13 | Tabs: Feed, Digests, Official, Analyst, Competitors, About | Chat dropped pre-launch; Watchlist/Saved/Notes dropped post-launch (low utility for a single-user site). About added with a loud "not investment advice / vibe-coded" disclaimer. |
| 2026-05-13 | Drop items with classifier relevance < 0.5 (raised from 0.4) + tighten priority rubric | First-run backfill produced too many "breaking" items because the original rubric called every S-1/8-K breaking. Default is now 'routine'; only material events escalate. |
| 2026-05-13 | Insider Activity surfaced as widget inside Official tab | Form 4 already in ingest; no need for a separate tab |
| 2026-05-14 | Analyst tab = Finnhub free tier (quote, monthly consensus, recommendation trend, earnings beat/miss) | Yahoo Finance for analyst data 401s from Vercel; E*TRADE / Bloomberg / Refinitiv content is licensed-to-user and not legally redistributable. Finnhub free tier covers ~60–70% of the useful signal. Premium endpoints (per-analyst upgrade/downgrade, price targets, estimate revisions) explicitly out of scope. |
| 2026-05-14 | Stock chart cached in `chart_points` table, refreshed hourly via GH Actions | Yahoo Finance aggressively rate-limits Vercel IPs (429 on every render). One hourly write from a rotating GH Actions runner is enough, and the page reads straight from Postgres. |
| 2026-05-14 | Form 4 XML parsed at ingest, structured fields merged into `raw_json` | Insider Activity widget needs reporter/role/shares/value — title alone is useless. cheerio (already a dep) handles the XML; ≤10 req/s to EDGAR. |
| 2026-05-14 | Digests get an `## Investor highlights` H2 with a structured Form 4 preamble | Opus can synthesize multi-row Form 4 events into a single narrative when given the parsed transactions as a flat list (date, reporter, role, direction, shares, value, url). Without the preamble it hallucinates numbers. |
| 2026-05-14 | Switch ingest cron to GitHub Actions (was Vercel Cron) | Vercel Hobby caps cron at 2 daily-only entries. GH Actions matrix gives us per-source sub-hourly/hourly granularity for free. |
| 2026-05-14 | High-freq tick at `*/5`, news `MAX_ITEMS=60`, saturation alerts, HN watermark/paginate, SEC dedup-first walk, Reddit parallel-subs | Spike-day analysis showed the old `*/15` + 30-item cap could silently lose articles when coverage flooded (e.g. earnings). Tighter cadence + wider cap + per-tick saturation tripwire (GH Actions fail + Resend email) means we know when we're losing items, and HN/SEC self-heal on backlog. Reddit parallelization fixes a real 504 at the 60s function cap. No meaningful cost delta — classifier is per-new-item, not per-poll. |
| 2026-05-14 | Saturation counter excludes classifier-dropped items | The first deployment of the saturation tripwire fired on the noisy `Pencil` competitor query (15/15 "new" items, but the classifier deleted all 15 as low-relevance). Items that wouldn't have been kept anyway aren't lost content. `countsForSaturation()` in `_shared.ts` now only counts `'new'` and `'error'` outcomes toward the cap, not `'dropped'` or `'dedup'`. |
| 2026-05-14 | Digest worker: `withRetry` on DB calls + DB-outage-fallback failure alert | The morning of 2026-05-14, the 09:00 PDT launchd run failed all 14 catch-up ranges within 600 ms because the first connect-attempt errored and there was no retry. Two-part fix: (1) `withRetry()` wraps every DB call (digestExists, fetchItemsForPeriod, fetchInsiderForPeriod, insertDigest) in a 3-attempt 500 ms / 2 s / 8 s back-off; (2) `notifyDigestFailure()` uses an `emailChannelsForAlert()` helper that falls back to `RESEND_TO_EMAIL` env when the DB channel lookup fails — because the most common digest-failure cause IS the DB being unreachable, and the alert can't depend on the same DB. Returns `{sent, channels}` so the worker logs `failure_alert_sent` only when an email actually went out. |
| 2026-05-15 | Cluster drill-in route `/cluster/[id]` | The "+N similar" badge was static — clustered items were unreachable from the UI (feed hardcodes `groupByCluster: true`, no toggle). Badge now links to `/cluster/[id]`, which lists every member of the cluster (most-recent first) via `fetchClusterById()`, reusing `ItemCard`. Members render with their real titles and no recursive badge. |
| 2026-05-15 | Doc extraction moved to local Claude Code (Max plan); uploads local-only; .docx preserved | API-key cost analysis showed the Sonnet doc-extractor was the single largest spike (~$5.7 on 2026-05-13's bulk earnings ingest) — every upload sent a full base64 PDF to Sonnet at $3/1M. `extractDocument(filePath)` now spawns the local `claude --print` CLI ($0 Max-plan capacity), same pattern as the digest worker: **PDF** is read by local Claude via its Read tool (same multimodal fidelity); **Word .docx** keeps the `mammoth` text-extraction added the same day, but the text is now inlined into the local-CLI prompt instead of sent as an API text/plain block. The `/admin/upload` web form + `uploadDocument` server action were removed (deployed app has no Claude CLI and we don't want an API path), leaving a read-only management view; `scripts/ingest-pdfs.ts` is the sole ingest entry point. Signature changed `(pdfBase64)`/`(bytes, filename)` → `(filePath)`. Classifier + clustering stay on API Haiku (low latency, runs on Vercel cron where no local CLI exists). |
| 2026-05-17 | Classifier batched (coalesced Haiku calls) + `ai_usage` cost-attribution table; no prompt caching | Follow-up cost analysis (CSV 05-11→05-17) showed the classifier was ~75% of API spend: one uncached Haiku call per item re-sending the ~1k-token system prompt. **Prompt caching does not help here** — live probes proved Haiku 4.5's cache floor is ~4096 tokens (not the 2048 of Haiku 3/3.5), and below it `cache_control` is a silent no-op (this is why the pre-existing `cache_control` never engaged — zero cache rows in billing). Instead, concurrent `classifyItem` calls (pollers already classify in concurrent chunks) are coalesced into one batched request; per-item signature/result unchanged so no poller edits. Measured ~85% input-token cut at batch 12 (191 vs ~1250 tok/item); failed/omitted ids retried individually so a bad batch never loses classifications; cross-item prompt-injection isolation verified. Dead `cache_control` removed from `cluster.ts`. New `ai_usage` table (migration 0002) logs per-call tokens by job so the real saving is measurable (billing CSV can't split classify vs cluster). |
| 2026-05-14 | Manual uploads collapse to single source row + exempted from clustering | Previous design routed each detected `doc_type` (analyst-report / transcript / presentation / report / other) to its own `sources` row. Resulted in cluttered per-source filters on /feed and uploads getting hidden behind scraped news representatives in cluster groups. `manualUploadSource()` now always returns `{name: "Manual uploads", kind: "upload"}`; the detected doc_type is preserved in `raw_json.extraction.doc_type` for display. `clusterRecent()` excludes `kind='upload'` from candidate items so user-uploaded PDFs always show as their own row in /feed. |
| 2026-05-14 | Per-digest permalink route `/digests/[id]` | Sharing a digest required pointing someone at the whole list. New route renders a single digest standalone (same body + sources footer as the list view) with shareable URL `https://css-lake-three.vercel.app/digests/N`. Card titles on /digests and the home dashboard's Recent digests now link to the permalink. Item-detail page also renders `full_text` as Markdown HTML when `raw_json.render === "markdown"` — forward-compatible for any rich-content manual-upload row. |
| 2026-05-14 | Event-period digests authored manually | The scheduled digest worker produces day/week/month digests; for one-off analytical digests (earnings deep-dives, incident post-mortems), `scripts/insert-digest.ts` writes a row with `period='event'` directly to the `digests` table. The `/digests` filter UI gained an "Event" option. First use: Q1 FY2026 comparative deep-dive (id=36) referencing 15 source PDFs from /admin/upload. |
| 2026-05-14 | Bulk PDF ingest via `scripts/ingest-pdfs.ts` | `/admin/upload` is fine for one-off PDFs but blocking when ingesting a folder of past-quarter earnings docs. The script replicates the same Sonnet-extract → classify → insert pipeline as the server action but takes file paths as CLI args. SHA-256 dedups against `items.external_id`, skips files >30 MB (Anthropic's PDF API cap is 32 MB). |
| 2026-05-14 | Public read-only site; only `/admin/*` is gated | Allowlist auth added friction with zero benefit — the data is already public elsewhere. GitHub sign-in stays for admin tools (competitor management). |
| 2026-05-13 | Retention: keep everything forever | DB is small, archival is valuable for digests |
| 2026-05-13 | Notifications: Resend (email only for v1) | 3k emails/mo free; lightweight setup; Slack/Discord can be added later |
| 2026-05-13 | Auth: NextAuth + GitHub OAuth, allowlist via env var | Per-user identity preserved for bookmarks/notes; allowlist defaults to just the owner |
| 2026-05-13 | Pre-seed defaults (people, topics, competitors, subs) | User opted in; lets v1 be useful from minute one |
| 2026-05-13 | Drop Chat tab and on-demand per-item summaries | Chat + lazy summaries inherently want real-time API calls; not worth the spend for a personal tool. Search via Postgres FTS is sufficient. |
| 2026-05-13 | Digests run via local Claude Code (Max plan), not API | Uses existing Max subscription instead of API spend; digests are batched/async and tolerate the laptop-on dependency (catch-up logic handles missed runs). Classifier + clustering stay on API for low latency. |
| 2026-05-13 | Drop Voyage embeddings and `item_embeddings` table | No chat = no RAG = no embeddings needed. `pgvector` extension stays enabled on Neon for future use but is unused in v1. |
| 2026-05-13 | No dedicated `ir-press` poller; rely on SEC 8-K | `investor.figma.com` is Cloudflare-gated; Q4 JSON syndication returns empty. SEC 8-K already captures every material press release with ~hours of latency. See operational note. |

## Open questions

None blocking v1 scope. To resolve during scaffolding:

- Exact Figma blog RSS URL (verify `figma.com/blog/feed/` or equivalent)
- Figma's SEC CIK (look up at first ingest run; not assigned until S-1 filed)
- Owner's GitHub username for the auth allowlist: `tGoh98` (recorded)
