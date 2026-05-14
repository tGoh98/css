# Local Setup — Digest Worker

This document covers the **local** side of CSS: the `launchd`-driven digest
worker that runs on the owner's Mac, invokes the Claude Code CLI (Sonnet 4.6
on the Max plan), and writes summaries back to Neon. Ingest runs from
GitHub Actions cron (see `.github/workflows/cron.yml`) and has no local
component.

See `docs/ARCHITECTURE.md` → "AI usage" and "Scheduling" for the why.

---

## 1. Prerequisites

- macOS (the worker uses `launchd`).
- **Claude Code CLI** installed and signed in on the Max plan.
  - Verify with `claude --version` and `claude --print "hi"`.
  - Authentication: run `claude` once interactively to complete sign-in if
    you haven't already.
- **Node 22+**.
- **tsx** (already a devDependency of this repo). Confirm with:
  ```
  cd /Users/tgoh/playground/css
  npx tsx --version
  which tsx       # if you want the absolute path
  ```
  If `which tsx` is empty, you can either:
    - install globally: `npm i -g tsx`, then `which tsx`, or
    - use the in-repo binary directly: `node_modules/.bin/tsx`
      (full path: `/Users/tgoh/playground/css/node_modules/.bin/tsx`).
- The repo cloned at `/Users/tgoh/playground/css` (the plists hardcode this
  path — edit if yours differs).

---

## 2. Env file at `~/.config/css/digest.env`

The worker reads its environment from `~/.config/css/digest.env` (outside the
repo, mode 600). It does **not** read `.env.local` — keeping the local-only
secrets separate from the repo prevents accidental commits.

```bash
mkdir -p ~/.config/css
cat > ~/.config/css/digest.env <<'EOF'
DATABASE_URL=postgres://...neon...   # same value as Vercel
APP_URL=https://css-lake-three.vercel.app
DIGEST_WEBHOOK_SECRET=<paste-the-same-value-set-in-Vercel>
EOF
chmod 600 ~/.config/css/digest.env
```

Required keys:

| Key | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string. Required. |
| `APP_URL` | Base URL of the deployed web app. Used to ping the digest-published webhook so an email can be sent. |
| `DIGEST_WEBHOOK_SECRET` | Shared secret with the Vercel `/api/webhooks/digest-published` route. Must match `DIGEST_WEBHOOK_SECRET` in Vercel env. |

Optional:

| Key | Default | Purpose |
|---|---|---|
| `CLAUDE_BIN` | `claude` | Override the Claude Code CLI binary path if it's not on the launchd `$PATH`. |

If `APP_URL` or `DIGEST_WEBHOOK_SECRET` is missing, the worker still writes
the digest row but logs a `webhook_skipped` warning instead of pinging the
webhook.

---

## 3. Install the launchd plists

The repo ships templates at `scripts/launchd/com.css.digest-{daily,weekly,monthly}.plist`.
They contain two placeholders you must substitute:

- `TSX_PATH` → the absolute path to `tsx` from `which tsx` (e.g.
  `/opt/homebrew/bin/tsx` or `/Users/tgoh/playground/css/node_modules/.bin/tsx`).
- `HOME_PATH` → your home directory (e.g. `/Users/tgoh`). The plists need
  absolute paths because `launchd` doesn't expand `~`.

Install:

```bash
mkdir -p ~/Library/LaunchAgents
mkdir -p ~/.local/state/css     # log directory

# Find tsx:
TSX=$(which tsx)
echo "tsx is at: $TSX"

# Copy templates and substitute the placeholders.
for p in daily weekly monthly; do
  sed -e "s|TSX_PATH|$TSX|g" \
      -e "s|HOME_PATH|$HOME|g" \
      scripts/launchd/com.css.digest-$p.plist \
    > ~/Library/LaunchAgents/com.css.digest-$p.plist
done

# Load them.
launchctl load ~/Library/LaunchAgents/com.css.digest-daily.plist
launchctl load ~/Library/LaunchAgents/com.css.digest-weekly.plist
launchctl load ~/Library/LaunchAgents/com.css.digest-monthly.plist
```

To reload after editing a plist:

```bash
launchctl unload ~/Library/LaunchAgents/com.css.digest-daily.plist
launchctl load   ~/Library/LaunchAgents/com.css.digest-daily.plist
```

### Schedules

| Plist | Schedule |
|---|---|
| `com.css.digest-daily.plist` | every day at 09:00 local |
| `com.css.digest-weekly.plist` | Mondays at 09:00 local |
| `com.css.digest-monthly.plist` | 1st of each month at 09:00 local |

All three have `RunAtLoad=true`, so loading them triggers an immediate run
that uses the script's `--catch-up` mode to backfill any missed periods.
That means if your Mac is asleep at 09:00, the next time it wakes and
`launchd` fires (or you load/reload the plist) the missing digest will be
generated.

---

## 4. Verify

```bash
# Are they loaded?
launchctl list | grep com.css.digest

# Manual trigger of the daily job (handy for first-run smoke testing).
launchctl start com.css.digest-daily

# Or run the worker directly without launchd:
cd /Users/tgoh/playground/css
tsx scripts/run-digest.ts --period day --date 2026-05-12
```

Expected output: one or more JSON-formatted log lines like

```json
{"ts":"2026-05-13T09:00:01.123Z","level":"info","event":"run_start","period":"day","catchUp":true,"ranges":[...]}
{"ts":"2026-05-13T09:00:42.987Z","level":"info","event":"digest_written","period":"day","periodStart":"2026-05-12T00:00:00.000Z","itemCount":37,"digestId":12,"model":"claude-sonnet-4-6 (via Claude Code)","status":"ok"}
{"ts":"2026-05-13T09:00:43.111Z","level":"info","event":"webhook_posted","digestId":12,"status":200}
```

---

## 5. Logs

| Path | Contents |
|---|---|
| `~/.local/state/css/digest.log` | structured JSON log (one line per event) — written by the script itself |
| `~/.local/state/css/digest-daily-stdout.log` | raw stdout from the daily launchd job |
| `~/.local/state/css/digest-daily-stderr.log` | raw stderr from the daily launchd job |
| `~/.local/state/css/digest-weekly-{stdout,stderr}.log` | weekly job |
| `~/.local/state/css/digest-monthly-{stdout,stderr}.log` | monthly job |

Tail the structured log live:

```bash
tail -f ~/.local/state/css/digest.log
```

If something is wrong, the stderr logs are the place to start.

---

## 6. Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.css.digest-daily.plist
launchctl unload ~/Library/LaunchAgents/com.css.digest-weekly.plist
launchctl unload ~/Library/LaunchAgents/com.css.digest-monthly.plist
rm ~/Library/LaunchAgents/com.css.digest-*.plist
```
