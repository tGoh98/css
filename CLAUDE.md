# Claudy Simple Server (CSS)

Personal web app that aggregates and synthesizes Figma-related signal — news, SEC filings, Figma's own channels, community sources, and competitors. Scheduled AI digests, per-item breaking-news classifier, push notifications, search, chat over the corpus.

"CSS" is a backronym for Claudy Simple Server (the repo lives at `playground/css`).

## Where to look first

- `docs/ARCHITECTURE.md` — system design, data model, sources, AI usage, deployment, decisions log, open questions
- Project memory at `~/.claude/projects/-Users-tgoh-playground-css/memory/` — user preferences, project context, recent decisions

## Stack

- Next.js + TypeScript (App Router), shadcn/ui + Tailwind
- Neon Postgres
- Anthropic API: Haiku 4.5 for classifier, lazy per-item summaries, and topic clustering; Sonnet 4.6 for digests and chat
- Vercel Cron for scheduling
- NextAuth + GitHub OAuth for auth, with a GitHub username allowlist (just the user for v1)
- Resend for transactional email; Voyage AI for embeddings

## Conventions

- TypeScript strict mode
- Secrets in `.env.local` (gitignored)
- One ingest poller per source, kept thin and idempotent
- Database access through thin query functions, no heavy ORM
- Don't add features beyond what's in ARCHITECTURE.md without discussing first
