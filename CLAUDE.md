# Claudy Simple Server (CSS)

Personal web app that aggregates and synthesizes Figma-related signal — news, SEC filings, Figma's own channels, community sources, and competitors. Scheduled AI digests, per-item breaking-news classifier, push notifications, search.

"CSS" is a backronym for Claudy Simple Server (the repo lives at `playground/css`).

## Where to look first

- `docs/ARCHITECTURE.md` — system design, data model, sources, AI usage, deployment, decisions log, open questions
- Project memory at `~/.claude/projects/-Users-tgoh-playground-css/memory/` — user preferences, project context, recent decisions

## Stack

- Next.js + TypeScript (App Router), shadcn/ui + Tailwind
- Neon Postgres (pgvector enabled but unused in v1)
- Anthropic API (Haiku 4.5) for the ingest-time classifier and topic clustering
- Scheduled digests (Sonnet 4.6) run **locally** via `claude --print` on the owner's Mac (Max plan capacity), writing `summary_md` back to Neon
- Vercel Cron for ingest/clustering/notify jobs; `launchd` on the owner's Mac for the digest jobs
- NextAuth + GitHub OAuth for auth, allowlist via `AUTH_ALLOWLIST` env (just `tGoh98` for v1)
- Resend for transactional email (notifications)

## Conventions

- TypeScript strict mode
- Secrets in `.env.local` (gitignored)
- One ingest poller per source, kept thin and idempotent
- Database access through thin query functions, no heavy ORM
- Don't add features beyond what's in ARCHITECTURE.md without discussing first
