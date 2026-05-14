#!/bin/bash
# Pings a Vercel cron endpoint with the CRON_SECRET bearer token.
# Used by the local launchd jobs (com.css.ingest-*.plist) to drive the
# ingest pipeline at a higher frequency than Vercel Hobby cron allows.
#
# Usage:
#   scripts/ingest-poke.sh tick-15m
#   scripts/ingest-poke.sh tick-hourly

set -u

ENV_FILE="${HOME}/.config/css/digest.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "$(date -u +%FT%TZ) [ingest-poke] FATAL: env file not found at $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

if [ -z "${APP_URL:-}" ]; then
  echo "$(date -u +%FT%TZ) [ingest-poke] FATAL: APP_URL not set in $ENV_FILE" >&2
  exit 1
fi
if [ -z "${CRON_SECRET:-}" ]; then
  echo "$(date -u +%FT%TZ) [ingest-poke] FATAL: CRON_SECRET not set in $ENV_FILE" >&2
  exit 1
fi

TICK="${1:-}"
if [ -z "$TICK" ]; then
  echo "$(date -u +%FT%TZ) [ingest-poke] FATAL: missing tick name (e.g. tick-15m)" >&2
  exit 1
fi

URL="${APP_URL%/}/api/cron/${TICK}"
START="$(date -u +%FT%TZ)"
RESP=$(curl -sS -o /tmp/css-ingest-poke-body -w '%{http_code}' \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  --max-time 90 \
  "$URL") || {
  echo "$(date -u +%FT%TZ) [ingest-poke] ERROR: curl failed for $URL" >&2
  exit 1
}

BODY=$(head -c 500 /tmp/css-ingest-poke-body)
echo "${START} [ingest-poke] tick=${TICK} status=${RESP} body=${BODY}"
case "$RESP" in
  2*) exit 0 ;;
  *) exit 1 ;;
esac
