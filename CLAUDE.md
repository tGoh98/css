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
- One ingest poller per source, kept thin and idempotent
- Database access through thin query functions, no heavy ORM
- Don't add features beyond what's in ARCHITECTURE.md without discussing first

## Secrets and sensitive data — STRICT

This is a public GitHub repo. **Anything pushed is exposed forever** — rewriting history is not sufficient because the values have already been served to viewers, archives, and search indexes. Treat every commit like a billboard.

**NEVER commit:**
- Real API keys, tokens, passwords, OAuth client secrets, webhook secrets, session secrets
- Real database connection strings (anything with a live password/host)
- Personally identifying information beyond what's already public (emails, phone numbers, addresses, IDs)
- Private keys / certificates (`.pem`, `.key`, service account JSON)
- Any file matching `.env`, `.env.local`, `.env.*.local` (these are gitignored; never `git add -f` them)
- Output of `vercel env pull`, `neon connect`, or similar — these dump real values

**Always use placeholders in committed files:**
- `.env.local.example` — empty values only (`KEY=`)
- Docs / READMEs — placeholders like `<paste-from-Vercel>` or `<your-key-here>`
- Code — read from `process.env.X`, never hardcode

**Before every commit:** check the diff. Would any value here leak a secret if a stranger forked the repo? Run `git diff --staged` and scan for high-entropy strings, URLs with passwords, anything that looks like a token prefix (`sk-ant-`, `re_`, `gh[pos]_`, `npg_`, etc.).

**Don't paste real secret values in chat messages either** — Claude Code transcripts persist. The Neon password was leaked once on 2026-05-13 and had to be rotated. Don't repeat.

**If a secret IS committed (or pushed, or chat-pasted):**
1. Rotate it IMMEDIATELY at the source (Neon, Anthropic, Resend, GitHub OAuth App, etc.).
2. Update Vercel env vars + local `~/.config/css/digest.env` with the new value.
3. Note the rotation in the next commit message so future-you knows.
4. Do NOT try to scrub git history with rebase/filter-branch — assume the old value is exposed and burn it.

When adding a new secret env var, update all of: Vercel env vars, `.env.local.example` (empty placeholder), `.env.local` (locally only), and any reference docs (with placeholder).
