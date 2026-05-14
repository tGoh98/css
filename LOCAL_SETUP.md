# Local Setup — Digest Worker & Ingest Poker

This document covers the **local** side of CSS, two pieces:

1. **Digest worker** — `launchd` invokes the Claude Code CLI (Sonnet 4.6 on
   the Max plan), generates daily/weekly/monthly digests, writes them to
   Neon.
2. **Ingest poker** — `launchd` curls the Vercel `/api/cron/tick-*` routes
   on a 15-minute and hourly cadence. We do this on the Mac because the
   Vercel Hobby plan caps cron frequency at *daily*; the routes themselves
   live on Vercel.

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
CRON_SECRET=<paste-the-same-value-set-in-Vercel>
EOF
chmod 600 ~/.config/css/digest.env
```

Required keys:

| Key | Purpose |
|---|---|
| `DATABASE_URL` | Neon connection string. Required by the digest worker. |
| `APP_URL` | Base URL of the deployed web app. Used by both the digest worker (digest-published webhook) and the ingest poker (target host). |
| `DIGEST_WEBHOOK_SECRET` | Shared secret with the Vercel `/api/webhooks/digest-published` route. Must match `DIGEST_WEBHOOK_SECRET` in Vercel env. Required by the digest worker. |
| `CRON_SECRET` | Bearer token expected by the Vercel `/api/cron/*` routes. Must match `CRON_SECRET` in Vercel env. Required by the ingest poker. |

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

## 6. Install the ingest poker plists

Two plists drive the Vercel `/api/cron/tick-*` endpoints from your Mac.
They use `scripts/ingest-poke.sh` (a small bash script that sources the
env file, then curls the endpoint with the `CRON_SECRET` bearer token).

| Plist | Schedule | Hits | Triggers |
|---|---|---|---|
| `com.css.ingest-15m.plist` | every 15 min | `/api/cron/tick-15m` | news + reddit + hn |
| `com.css.ingest-hourly.plist` | hourly (on the hour) | `/api/cron/tick-hourly` | figma-blog + sec + competitors + analyst + cluster |

Install:

```bash
mkdir -p ~/Library/LaunchAgents
mkdir -p ~/.local/state/css

# Make the poke script executable (already is in the repo, but harmless).
chmod +x /Users/tgoh/playground/css/scripts/ingest-poke.sh

# Substitute HOME_PATH (launchd doesn't expand ~ / $HOME) and install.
for p in 15m hourly; do
  sed -e "s|HOME_PATH|$HOME|g" \
      scripts/launchd/com.css.ingest-$p.plist \
    > ~/Library/LaunchAgents/com.css.ingest-$p.plist
done

launchctl load ~/Library/LaunchAgents/com.css.ingest-15m.plist
launchctl load ~/Library/LaunchAgents/com.css.ingest-hourly.plist
```

Verify:

```bash
launchctl list | grep com.css.ingest

# Manual smoke test:
/Users/tgoh/playground/css/scripts/ingest-poke.sh tick-15m
```

You should see something like:

```
2026-05-13T17:00:00Z [ingest-poke] tick=tick-15m status=200 body={"ok":true,"news":{"inserted":3,"skipped":0,"errors":[]}, ...}
```

Logs:

| Path | Contents |
|---|---|
| `~/.local/state/css/ingest-15m-stdout.log` | poke output (one line per run) |
| `~/.local/state/css/ingest-15m-stderr.log` | stderr (env errors, curl failures) |
| `~/.local/state/css/ingest-hourly-{stdout,stderr}.log` | hourly job |

`RunAtLoad=true` on both, so loading the plists kicks off an immediate
first run, and missed runs while the Mac was asleep get picked up on the
next launchd tick.

---

## 7. Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.css.digest-daily.plist
launchctl unload ~/Library/LaunchAgents/com.css.digest-weekly.plist
launchctl unload ~/Library/LaunchAgents/com.css.digest-monthly.plist
launchctl unload ~/Library/LaunchAgents/com.css.ingest-15m.plist
launchctl unload ~/Library/LaunchAgents/com.css.ingest-hourly.plist
rm ~/Library/LaunchAgents/com.css.digest-*.plist
rm ~/Library/LaunchAgents/com.css.ingest-*.plist
```
