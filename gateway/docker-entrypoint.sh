#!/usr/bin/env bash
set -euo pipefail
P="$HOME/.dani"
: "${DANI_TELEGRAM_TOKEN:?set the DANI_TELEGRAM_TOKEN secret}"
umask 077
printf '%s' "$DANI_TELEGRAM_TOKEN" > "$P/secrets/telegram-bot-token"
[ -n "${DANI_PAIRING_JSON:-}" ] && [ ! -s "$P/state/pairing.json" ] && printf '%s' "$DANI_PAIRING_JSON" > "$P/state/pairing.json"
[ -n "${CARTESIA_API_KEY:-}" ] && printf '%s' "$CARTESIA_API_KEY" > "$P/secrets/cartesia-api-key"
unset DANI_TELEGRAM_TOKEN DANI_PAIRING_JSON CARTESIA_API_KEY
export MCP_PORT="${PORT:-${MCP_PORT:-8080}}"
exec "$P/bin/dani-supervise"
