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

1. **Feed** — chronological list of every item across every source. Filterable by source, time range, and topic cluster. Full-text search pinned at the top.
2. **Digests** — scheduled AI summaries (daily / weekly / monthly), with time-range filter.
3. **Official** — SEC filings + Figma's own blog/press releases. FIG ticker chart pinned at top with news/filings overlaid as event markers. Dedicated **Insider Activity** widget summarizing recent Form 4 transactions (who, how many shares, at what price, cumulative-by-person).
4. **Watchlist** — saved filters for specific people (Dylan Field, exec team) and topics ("AI features", "acquisitions"). Each watchlist gets its own filtered feed view.
5. **Competitors** — Adobe, Canva, Sketch, Penpot. Same shape as Feed but scoped.
6. **Analyst** — consensus ratings + price-target chart over time, rating-change events, Seeking Alpha free-tier articles. Note: full proprietary reports (Morningstar, Goldman, JPM) are paywalled behind Bloomberg/Refinitiv and not realistically scrapable.

### Cross-cutting

- **Search** — `Cmd-K` palette plus a search bar on Feed. Postgres full-text search over title + snippet + full_text + classifier `one_line`.
- **Bookmarks & notes** — every item has a bookmark toggle and a freeform notes field. "Saved" view collects bookmarked items across tabs.
- **Topic clustering / dedup** — items grouped by Haiku into clusters; the Feed collapses N near-duplicates into a single card with a count + "see all".
- **Push notifications** — email via Resend for breaking items. Default off, opt-in.

### Per-item behavior

- Title, source badge, published date, classifier `one_line` (one-sentence AI blurb generated at ingest), priority badge (breaking/notable/routine), bookmark toggle
- Click → detail view with the full snippet/text (no on-demand AI call), notes field, link out

## Architecture

```
                ┌──────────────────────────────────┐
Vercel Cron ──► │ Ingest workers (one per source)  │
                │ news / SEC / Figma blog / reddit │
                │ / HN / competitors               │
                └──────────────┬───────────────────┘
                               │ for each new item:
                               │   1. dedup by external_id
                               │   2. Haiku classifier (relevance + priority + one_line) — API
                               │   3. drop if relevance < 0.4
                               │   4. assign to topic cluster
                               │   5. insert
                               │   6. if priority='breaking' → enqueue notification
                               ▼
                ┌──────────────────────────────────┐
                │ Neon Postgres                    │
                │ items, sources, classifications, │
                │ digests, clusters, watchlists,   │
                │ bookmarks, notes,                │
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
                      │  │ Sonnet 4.6 via Max plan           │
                      │  │ batches: daily/weekly/monthly     │
                      │  │ writes summary_md back to Neon    │
                      │  └──────────────────────────────────┘
                      ▼
                ┌──────────────────────────────────┐
                │ Next.js app on Vercel            │
                │ Feed / Digests / Official /      │
                │ Watchlist / Competitors / Analyst│
                │ (+ Search, Bookmarks, Notes)     │
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

watchlists
  id, name, kind ('person'|'topic'|'keyword'), match_config_json, created_at

bookmarks
  item_id pk, created_at

item_notes
  item_id pk, body_md, updated_at

notification_channels
  id, kind ('email'|'slack'|'discord'), config_json, enabled

notifications_sent
  item_id, channel_id, sent_at  -- dedup so we don't notify twice

users
  id, email, github_id, github_username, created_at
  -- v1 allowlist: just the owner; expand by env var later
```

Indexes: `items(published_at desc)`, `items(source_id, published_at desc)`, `items(cluster_id)`, `item_classifications(priority)`, GIN index on items full_text for FTS.

## Sources

### Core (Figma)

| Source | API/feed | Polling | Backfill depth | Notes |
|---|---|---|---|---|
| Google News | RSS `news.google.com/rss/search?q=Figma` | 15 min | Recent only (~weeks) | Unofficial but reliable. Headlines + snippets across WSJ, Bloomberg, TechCrunch, The Verge, Barron's, etc. |
| SEC EDGAR | `data.sec.gov/submissions/CIK*.json` + filings index | hourly | Full history (since S-1, Apr 2025) | Free, no key. Pull 10-K, 10-Q, 8-K, S-1, Form 4. Form 4 powers Insider Activity widget. |
| Figma blog | RSS at `figma.com/blog/feed/` (or equivalent) | hourly | Last ~20 via RSS; full archive via scrape | |
| Reddit | `reddit.com/r/<sub>/search.json?q=Figma` across r/Figma, r/stocks, r/wallstreetbets, r/investing, r/design | 15 min | Last ~few months via search | Rate-limited; Pushshift dead. |
| Hacker News | Algolia `hn.algolia.com/api/v1/search?query=Figma` | 15 min | Full history (years) | Free, no key. Best historical community-signal source. |

### Competitor

| Source | API/feed | Polling | Notes |
|---|---|---|---|
| Adobe news | Google News RSS scoped to Adobe + Adobe newsroom RSS | hourly | High volume — relevance filter important |
| Canva news | Google News RSS scoped to Canva + Canva blog RSS | hourly | |
| Sketch | Sketch blog RSS | daily | Low volume |
| Penpot | Penpot blog RSS + GitHub releases | daily | Low volume; OSS so GH releases are signal |

### Analyst

| Source | API/feed | Notes |
|---|---|---|
| Yahoo Finance | Public endpoints for analyst ratings + price targets for FIG | Free, unofficial but stable |
| Seeking Alpha | RSS per ticker | Free tier shows headlines + summaries; full articles paywalled |

## AI usage

- **Ingest-time classifier (Anthropic API, Haiku 4.5).** One call per new item. JSON output: `{ relevance: 0–1, priority: routine|notable|breaking, one_line: string }`. Drop if `relevance < 0.4`. ~$0.0005/item.
- **Topic clustering (Anthropic API, Haiku 4.5).** Periodic job (every 30 min) re-clusters last-24h items by semantic similarity; picks a representative title. Small cost.
- **Scheduled digests (local Claude Code CLI, Sonnet 4.6, Max plan).** A `launchd` job on the user's Mac runs `scripts/run-digest.ts` daily / weekly / monthly. The script connects to Neon, pulls items for the period, invokes `claude --print` with a structured digest prompt, parses the response, and writes `summary_md` back to the `digests` table. Catch-up: each run checks the recent window for missing digests and generates them — so a daily digest missed because the Mac was asleep at 09:00 gets generated whenever the Mac next runs the job. Cost: $0 marginal (uses Max plan capacity, well within rate limits).

**Estimated monthly cost:** $3–5 API (classifier + clustering) + $0 for digests (Max plan) + $0 for notifications (Resend free tier).

## Scheduling

| Job | Cadence | Where | What |
|---|---|---|---|
| `ingest:news` | every 15 min | Vercel Cron | Google News RSS for Figma |
| `ingest:reddit` | every 15 min | Vercel Cron | Reddit search across configured subs |
| `ingest:hn` | every 15 min | Vercel Cron | HN Algolia search |
| `ingest:figma-blog` | hourly | Vercel Cron | Figma blog RSS |
| `ingest:sec` | hourly | Vercel Cron | EDGAR for new Figma filings |
| `ingest:competitors` | hourly | Vercel Cron | Adobe / Canva / Sketch / Penpot |
| `cluster:recent` | every 30 min | Vercel Cron | Re-cluster last-24h items |
| `notify:breaking` | event-driven | Vercel Function | On insert of priority=breaking, fan out to enabled channels |
| `digest:daily` | 09:00 daily | **launchd (user's Mac)** | Daily digest via local Claude Code |
| `digest:weekly` | Mondays 09:00 | **launchd (user's Mac)** | Weekly digest |
| `digest:monthly` | 1st of month 09:00 | **launchd (user's Mac)** | Monthly digest |

Local digest jobs use `StartCalendarInterval` + the script's catch-up logic so missed runs (Mac asleep, traveling, etc.) are picked up on next wake.

## Deployment

- **Web app:** Vercel (Next.js + serverless functions + Vercel Cron for ingest)
- **Database:** Neon Postgres (free tier). The `pgvector` extension is enabled but unused in v1 (kept available for a future "chat over corpus" feature if we add one).
- **Auth:** NextAuth + GitHub OAuth, allowlist via `AUTH_ALLOWLIST` env var (defaults to just the owner)
- **Digest worker:** runs on the owner's Mac. `scripts/run-digest.ts` is invoked by `~/Library/LaunchAgents/com.css.digest-daily.plist` (and `-weekly`, `-monthly`). Requires Claude Code CLI installed and authenticated on the Max plan.
- **Secrets (Vercel env vars):**
  - `DATABASE_URL` (Neon)
  - `ANTHROPIC_API_KEY` (classifier + clustering)
  - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_TO_EMAIL`
  - `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
  - `AUTH_ALLOWLIST` (comma-separated GitHub usernames, e.g. `tGoh98`)
- **Secrets (local, for digest worker):**
  - `DATABASE_URL` in `~/.config/css/digest.env` (outside the repo, mode 600)
- **Cost:** $0 infra (Vercel + Neon + Resend free tiers), ~$3–5/mo Anthropic API, $0 digests (Max plan)

## Backfill strategy

One-shot script per source: `npm run backfill:<source>`. Marks items with `backfilled = true`. Run once at project start, then normal cron takes over. Backfilled items go through the same classifier — relevance threshold handles noise.

- **SEC EDGAR** — walk filings index from Figma's CIK back to S-1 (Apr 2025). Cheap, complete.
- **Hacker News** — Algolia date-ranged search. Cheap, complete.
- **Figma blog** — scrape `/blog?page=N` paginated archive until exhausted.
- **Reddit** — search API with date ranges; accept ~few months of depth.
- **Google News** — no historical backfill via free path. Live forward only.
- **Competitors** — same shape as primary news (recent-only for news; full for blogs).

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-05-13 | Project name: Claudy Simple Server (CSS) | User-chosen; backronym for the existing `playground/css` directory |
| 2026-05-13 | Stack: Next.js + TS + Postgres | Best DX for "small site + scheduled jobs + auth"; one repo, one language |
| 2026-05-13 | Hosting: Vercel + Neon, NextAuth + GitHub OAuth | Same cost as local; always-on cron, friends can see it, no machine-uptime worry |
| 2026-05-13 | Single Haiku call does relevance + priority + one-line together | One round-trip handles "is this actually Figma" and "is this breaking" |
| 2026-05-13 | News aggregator = Google News RSS for v1 | Free and broad. NewsAPI free tier too restricted; paid tier overkill. |
| 2026-05-13 | Core sources for v1: Google News, SEC EDGAR, Figma blog, Reddit, HN | User confirmed |
| 2026-05-13 | Tabs: Feed, Digests, Official, Watchlist, Competitors, Analyst | 6 tabs (Chat dropped) |
| 2026-05-13 | Drop items with classifier relevance < 0.4 | Handles "Figma" false positives (math, foreign-language matches) |
| 2026-05-13 | Insider Activity surfaced as widget inside Official tab | Form 4 already in ingest; no need for a separate tab |
| 2026-05-13 | Analyst tab = ratings + price-target chart + rating-change events + Seeking Alpha RSS | Full proprietary reports require Bloomberg/Refinitiv; not realistically scrapable |
| 2026-05-13 | Retention: keep everything forever | DB is small, archival is valuable for digests |
| 2026-05-13 | Notifications: Resend (email only for v1) | 3k emails/mo free; lightweight setup; Slack/Discord can be added later |
| 2026-05-13 | Auth: NextAuth + GitHub OAuth, allowlist via env var | Per-user identity preserved for bookmarks/notes; allowlist defaults to just the owner |
| 2026-05-13 | Pre-seed defaults (people, topics, competitors, subs) | User opted in; lets v1 be useful from minute one |
| 2026-05-13 | Drop Chat tab and on-demand per-item summaries | Chat + lazy summaries inherently want real-time API calls; not worth the spend for a personal tool. Search via Postgres FTS is sufficient. |
| 2026-05-13 | Digests run via local Claude Code (Max plan), not API | Uses existing Max subscription instead of API spend; digests are batched/async and tolerate the laptop-on dependency (catch-up logic handles missed runs). Classifier + clustering stay on API for low latency. |
| 2026-05-13 | Drop Voyage embeddings and `item_embeddings` table | No chat = no RAG = no embeddings needed. `pgvector` extension stays enabled on Neon for future use but is unused in v1. |

## Open questions

None blocking v1 scope. To resolve during scaffolding:

- Exact Figma blog RSS URL (verify `figma.com/blog/feed/` or equivalent)
- Figma's SEC CIK (look up at first ingest run; not assigned until S-1 filed)
- Owner's GitHub username for the auth allowlist: `tGoh98` (recorded)
