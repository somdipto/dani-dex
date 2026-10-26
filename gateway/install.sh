#!/usr/bin/env bash
# Dani gateway - one-command installer for a fresh Linux x86_64 VM.
#
#   curl -fsSL https://raw.githubusercontent.com/somdipto/dani-alexa/main/install.sh | bash
#
# Gives you a 24/7 Telegram bot (your own @BotFather token) backed by the
# Dani free model stack, plus a local MCP endpoint for pairing desktop apps.
# Everything lives in ~/.dani. No root, no docker, no paid accounts.
set -euo pipefail

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()  { printf '   ok: %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

DANI_PREFIX="${DANI_PREFIX:-$HOME/.dani}"
DEX_VERSION="${DEX_VERSION:-0.18.5}"
OPENCODE_VERSION="${OPENCODE_VERSION:-v1.19.3}"
DANI_ALEXA_REPO="${DANI_ALEXA_REPO:-https://github.com/somdipto/dani-alexa.git}"
DANI_ALEXA_REF="${DANI_ALEXA_REF:-main}"
DANI_ALEXA_SRC="${DANI_ALEXA_SRC:-}"       # local checkout to install from instead of git clone
DANI_APPIMAGE="${DANI_APPIMAGE:-}"         # pre-downloaded Dani-Dex AppImage to reuse
DANI_CUA_PORT="${DANI_CUA_PORT:-4201}"     # computer-use brain port
DANI_DISPLAY="${DANI_DISPLAY:-${DISPLAY:-}}"  # display the computer-use worker drives; empty = disabled
DANI_OPENCODE_BIN="${DANI_OPENCODE_BIN:-}" # pre-downloaded opencode binary to reuse
DANI_FREE_PORT="${DANI_FREE_PORT:-4190}"
OPENCODE_PORT="${OPENCODE_PORT:-4199}"
MCP_PORT="${MCP_PORT:-8788}"
NO_SERVICE="${NO_SERVICE:-}"               # 1 = skip systemd, use nohup mode

[ "$(uname -s)" = "Linux" ] || die "Linux only. On macOS, use the Dani-Dex app instead."
[ "$(uname -m)" = "x86_64" ] || die "x86_64 only for now (detected: $(uname -m))"
need() { command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }
for c in curl tar sha256sum openssl; do need "$c"; done

say "Dani gateway"
echo "   prefix: $DANI_PREFIX"
mkdir -p "$DANI_PREFIX"/{bin,config,secrets,state,run,logs}

# --- node -----------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ "$(node -e 'process.stdout.write(String(parseInt(process.versions.node)))' 2>/dev/null || echo 0)" -ge 20 ]; then
  DANI_NODE="$(command -v node)"
  ok "node $(node --version) (system)"
else
  NODE_TAR="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64\.tar\.gz$/ {print $2; exit}')"
  [ -n "$NODE_TAR" ] || die "could not resolve a node download"
  say "installing node ($NODE_TAR)"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$NODE_TAR" -o /tmp/dani-node.tar.gz
  mkdir -p "$DANI_PREFIX/runtime"
  tar -xzf /tmp/dani-node.tar.gz -C "$DANI_PREFIX/runtime"
  rm -f /tmp/dani-node.tar.gz
  DANI_NODE="$DANI_PREFIX/runtime/${NODE_TAR%.tar.gz}/bin/node"
  [ -x "$DANI_NODE" ] || die "bundled node missing at $DANI_NODE"
  ok "node $("$DANI_NODE" --version) (bundled in prefix)"
fi

# --- gateway source --------------------------------------------------------
if [ -n "$DANI_ALEXA_SRC" ]; then
  rm -rf "$DANI_PREFIX/app"
  mkdir -p "$DANI_PREFIX/app"
  cp -r "$DANI_ALEXA_SRC/src" "$DANI_ALEXA_SRC/bin" "$DANI_ALEXA_SRC/test" "$DANI_ALEXA_SRC/package.json" "$DANI_PREFIX/app/"
  ok "gateway source copied from $DANI_ALEXA_SRC"
else
  need git
  rm -rf "$DANI_PREFIX/app"
  git clone --depth 1 --branch "$DANI_ALEXA_REF" "$DANI_ALEXA_REPO" "$DANI_PREFIX/app" >/dev/null 2>&1 \
    || die "git clone failed (repo private or offline). Set DANI_ALEXA_SRC=/path/to/checkout for a local install."
  ok "gateway source: $DANI_ALEXA_REPO@$DANI_ALEXA_REF"
fi

# --- opencode (agent runtime) ----------------------------------------------
if [ -n "$DANI_OPENCODE_BIN" ]; then
  cp "$DANI_OPENCODE_BIN" "$DANI_PREFIX/bin/opencode"
elif [ ! -x "$DANI_PREFIX/bin/opencode" ]; then
  say "downloading opencode $OPENCODE_VERSION"
  curl -fsSL "https://github.com/anomalyco/opencode/releases/download/$OPENCODE_VERSION/opencode-linux-x64.tar.gz" -o /tmp/dani-opencode.tar.gz
  TMPD="$(mktemp -d)"
  tar -xzf /tmp/dani-opencode.tar.gz -C "$TMPD"
  find "$TMPD" -name opencode -type f -exec cp {} "$DANI_PREFIX/bin/opencode" \; -quit
  rm -rf "$TMPD" /tmp/dani-opencode.tar.gz
fi
chmod +x "$DANI_PREFIX/bin/opencode"
[ -x "$DANI_PREFIX/bin/opencode" ] || die "opencode binary missing"
ok "opencode $OPENCODE_VERSION"

# --- dani-free (model runtime, ships inside the Dani-Dex AppImage) ----------
if [ ! -x "$DANI_PREFIX/bin/dani-free" ]; then
  IMG="$DANI_APPIMAGE"
  if [ -z "$IMG" ]; then
    IMG=/tmp/dani-dex.AppImage
    say "downloading Dani-Dex AppImage (~325MB, carries the model runtime)"
    curl -fsSL "https://github.com/somdipto/dani-dex/releases/download/v$DEX_VERSION/Dani-Dex-$DEX_VERSION-x86_64.AppImage" -o "$IMG"
  fi
  EXPECTED="$(curl -fsSL "https://github.com/somdipto/dani-dex/releases/download/v$DEX_VERSION/SHA256SUMS-linux.txt" | awk '/AppImage$/ {print $1; exit}')"
  echo "$EXPECTED  $IMG" | sha256sum -c - >/dev/null || die "AppImage checksum mismatch"
  chmod +x "$IMG"
  TMPX="$(mktemp -d)"
  (cd "$TMPX" && "$IMG" --appimage-extract >/dev/null 2>&1)
  [ -f "$TMPX/squashfs-root/resources/dani-free/linux/x64/dani-free" ] || die "dani-free not found inside AppImage"
  cp "$TMPX/squashfs-root/resources/dani-free/linux/x64/dani-free" "$DANI_PREFIX/bin/dani-free"
  chmod +x "$DANI_PREFIX/bin/dani-free"
  if [ -f "$TMPX/squashfs-root/resources/cua-driver/linux/x64/cua-driver" ]; then
    cp "$TMPX/squashfs-root/resources/cua-driver/linux/x64/cua-driver" "$DANI_PREFIX/bin/cua-driver"
    chmod +x "$DANI_PREFIX/bin/cua-driver"
    ok "cua-driver (computer-use) installed"
  else
    say "note: no cua-driver in this AppImage; computer-use worker disabled"
  fi
  rm -rf "$TMPX"
fi
ok "dani-free model runtime"

# --- config + secrets --------------------------------------------------------
TOKEN_FILE="$DANI_PREFIX/secrets/telegram-bot-token"
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  printf '%s' "$TELEGRAM_BOT_TOKEN" > "$TOKEN_FILE"
elif [ ! -s "$TOKEN_FILE" ]; then
  if [ -t 0 ]; then
    printf '\nTelegram bot token (from @BotFather): '
    read -r TELEGRAM_BOT_TOKEN
    [ -n "$TELEGRAM_BOT_TOKEN" ] || die "empty token"
    printf '%s' "$TELEGRAM_BOT_TOKEN" > "$TOKEN_FILE"
  else
    die "TELEGRAM_BOT_TOKEN not set and no terminal to ask. Run: TELEGRAM_BOT_TOKEN=123:abc bash install.sh"
  fi
fi
chmod 600 "$TOKEN_FILE"

[ -s "$DANI_PREFIX/secrets/mcp-token" ] || openssl rand -hex 16 | tr -d '\n' > "$DANI_PREFIX/secrets/mcp-token"
[ -s "$DANI_PREFIX/secrets/dani-free-api-key" ] || openssl rand -hex 32 | tr -d '\n' > "$DANI_PREFIX/secrets/dani-free-api-key"
chmod 600 "$DANI_PREFIX/secrets/"*
MCP_AUTH_TOKEN="$(cat "$DANI_PREFIX/secrets/mcp-token")"
DANI_FREE_API_KEY="$(cat "$DANI_PREFIX/secrets/dani-free-api-key")"
mkdir -p "$HOME/.config/dani-free"
cp "$DANI_PREFIX/secrets/dani-free-api-key" "$HOME/.config/dani-free/api-key"
chmod 600 "$HOME/.config/dani-free/api-key"

cat > "$DANI_PREFIX/config/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "dani": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Dani Free",
      "options": { "baseURL": "http://127.0.0.1:$DANI_FREE_PORT/v1", "apiKey": "{file:$DANI_PREFIX/secrets/dani-free-api-key}" },
      "models": { "dani-free-auto": { "name": "Dani Free Auto", "limit": { "context": 200000, "output": 8000 } } }
    }
  },
  "model": "dani/dani-free-auto",
  "small_model": "dani/dani-free-auto"
}
JSON

cat > "$DANI_PREFIX/env" <<ENVEOF
DANI_PREFIX=$DANI_PREFIX
DANI_NODE=$DANI_NODE
DANI_FREE_PORT=$DANI_FREE_PORT
OPENCODE_PORT=$OPENCODE_PORT
MCP_PORT=$MCP_PORT
MCP_AUTH_TOKEN=$MCP_AUTH_TOKEN
DANI_FREE_API_KEY=$DANI_FREE_API_KEY
TELEGRAM_BOT_TOKEN_FILE=$TOKEN_FILE
DANI_OPENCODE_BASE_URL=http://127.0.0.1:$OPENCODE_PORT
DANI_JOURNAL=$DANI_PREFIX/state/tasks.jsonl
DANI_MEMORY=$DANI_PREFIX/state/memory.jsonl
DANI_PAIRING=$DANI_PREFIX/state/pairing.json
DANI_TELEGRAM_STATE=$DANI_PREFIX/state/telegram-state.json
DANI_CUA_PORT=$DANI_CUA_PORT
DANI_CUA_BASE_URL=http://127.0.0.1:$DANI_CUA_PORT
DANI_DISPLAY=$DANI_DISPLAY
DANI_JOBS=$DANI_PREFIX/state/jobs.json
DANI_MCP_URL=http://127.0.0.1:$MCP_PORT
DANI_MCP_TOKEN_FILE=$DANI_PREFIX/secrets/mcp-token
DANI_TASTE=$DANI_PREFIX/state/taste.json
DANI_INBOX=$DANI_PREFIX/state/inbox.json
DANI_PENDING=$DANI_PREFIX/state/pending-question.json
DANI_WATCHES=$DANI_PREFIX/state/watches.json
ENVEOF
chmod 600 "$DANI_PREFIX/env"
mkdir -p "$DANI_PREFIX/opencode-cua" "$DANI_PREFIX/cua"
cat > "$DANI_PREFIX/opencode-cua/opencode.json" <<JSON2
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "dani": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Dani Free",
      "options": { "baseURL": "http://127.0.0.1:$DANI_FREE_PORT/v1", "apiKey": "{file:$DANI_PREFIX/secrets/dani-free-api-key}" },
      "models": { "dani-free-auto": { "name": "Dani Free Auto", "limit": { "context": 200000, "output": 8000 } } }
    }
  },
  "model": "dani/dani-free-auto",
  "small_model": "dani/dani-free-auto",
  "mcp": {
    "computer-use": {
      "type": "local",
      "command": ["$DANI_PREFIX/bin/cua-mcp"],
      "enabled": true,
      "timeout": 15000
    }
  }
}
JSON2
cat > "$DANI_PREFIX/bin/cua-mcp" <<WRAP
#!/bin/sh
# MCP proxy for the computer-use driver with a curated environment: the proxy
# inherits nothing from the brain that spawns it (model keys stay out of every
# process that does not need them).
exec /usr/bin/env -i \
  PATH=/usr/local/bin:/usr/bin:/bin \
  HOME="\$HOME" \
  CUA_DRIVER_EMBEDDED=1 \
  CUA_DRIVER_RS_TELEMETRY_ENABLED=0 \
  CUA_DRIVER_RS_UPDATE_CHECK=0 \
  "$DANI_PREFIX/bin/cua-driver" mcp --socket "$DANI_PREFIX/cua/driver.sock"
WRAP
chmod +x "$DANI_PREFIX/bin/cua-mcp"
if [ ! -s "$DANI_PREFIX/state/jobs.json" ]; then
  mkdir -p "$DANI_PREFIX/state"
  cat > "$DANI_PREFIX/state/jobs.json" <<'JOBS'
[
  {
    "id": "signal-sweep",
    "name": "Signal sweep",
    "intervalMin": 180,
    "quietStart": 1350,
    "quietEnd": 450,
    "enabled": true,
    "prompt": "You are Dani's signal sweep for Som (Dan Lab, building the Dani-Dex proactive agent). Look at what is new in AI/dev/agentic tooling right now (use your web tools if you have them). Keep only signal: things he can act on - new tools to try, releases that matter to an agent-harness builder, competitor moves. At most 4 items, one line each with why it matters to him. Plain text, no fluff, no filler greeting."
  },
  {
    "id": "morning-brief",
    "name": "Morning brief",
    "dailyAt": "08:30",
    "enabled": true,
    "prompt": "You are Dani's morning brief for Som. Short and warm: the date, what is on deck from memory (deadlines and open loops you know), then 3-5 signal items from overnight AI/dev news he can act on. Plain text."
  }
]
JOBS
fi
ok "config + secrets (0600 in $DANI_PREFIX/secrets)"

# --- runtime scripts ----------------------------------------------------------
cp "$DANI_PREFIX/app/bin/dani-supervise" "$DANI_PREFIX/app/bin/dani-up" "$DANI_PREFIX/app/bin/dani-down" "$DANI_PREFIX/app/bin/dani-status" "$DANI_PREFIX/app/bin/dani-update" "$DANI_PREFIX/app/bin/dani-tunnel" "$DANI_PREFIX/bin/"
chmod +x "$DANI_PREFIX/bin/"dani-*
ok "bin: dani-up / dani-down / dani-status"

# Chrome shows a blocking first-run terms dialog on a fresh profile, which stalls the computer-use worker; mark first run done
mkdir -p "$HOME/.config/google-chrome" && touch "$HOME/.config/google-chrome/First Run"

# --- start ----------------------------------------------------------------------
if [ -n "${SKIP_SELFTEST:-}" ]; then
  ok "image build: installed, not started"; exit 0
fi
if [ -z "$NO_SERVICE" ] && command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/dani-gateway.service" <<UNIT
[Unit]
Description=Dani gateway (Telegram bot + MCP)
After=network-online.target

[Service]
Type=simple
Environment=DANI_PREFIX=$DANI_PREFIX
ExecStart=$DANI_PREFIX/bin/dani-supervise
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now dani-gateway >/dev/null 2>&1 || true
  ok "systemd user service: dani-gateway (tip: loginctl enable-linger $USER)"
else
  DANI_PREFIX="$DANI_PREFIX" "$DANI_PREFIX/bin/dani-up" >/dev/null
  ok "started (nohup mode)"
fi

# --- self-test --------------------------------------------------------------------
say "self-test"
set -a; source "$DANI_PREFIX/env"; set +a

TRIES=0
until curl -fsS --max-time 5 -H "Authorization: Bearer $DANI_FREE_API_KEY" "http://127.0.0.1:$DANI_FREE_PORT/v1/models" >/dev/null 2>&1; do
  TRIES=$((TRIES + 1)); [ "$TRIES" -gt 60 ] && die "model runtime did not come up - see $DANI_PREFIX/logs/gateway.log"
  sleep 2
done
ok "model runtime answering on :$DANI_FREE_PORT"

TRIES=0
until curl -s --max-time 2 -o /dev/null "http://127.0.0.1:$OPENCODE_PORT/"; do
  TRIES=$((TRIES + 1)); [ "$TRIES" -gt 60 ] && die "agent runtime did not come up - see $DANI_PREFIX/logs/gateway.log"
  sleep 2
done
ok "agent runtime answering on :$OPENCODE_PORT"

TRIES=0
until curl -fsS --max-time 5 "http://127.0.0.1:$MCP_PORT/healthz" >/dev/null 2>&1; do
  TRIES=$((TRIES + 1)); [ "$TRIES" -gt 30 ] && die "MCP server did not come up - see $DANI_PREFIX/logs/gateway.log"
  sleep 2
done
ok "MCP endpoint healthy on :$MCP_PORT"

PONG="$("$DANI_NODE" "$DANI_PREFIX/app/test/selftest.mjs" 2>&1)" || die "agent round-trip failed: $PONG"
echo "$PONG" | grep -qi pong || die "agent round-trip gave an unexpected answer: $PONG"
ok "agent round-trip: $PONG"

say "Dani is live"
cat <<DONE
   Telegram : message your bot - it answers, remembers, and runs tasks
   Status   : $DANI_PREFIX/bin/dani-status
   Logs     : $DANI_PREFIX/logs/gateway.log
   Stop     : $DANI_PREFIX/bin/dani-down
   MCP      : http://127.0.0.1:$MCP_PORT/mcp  (token in $DANI_PREFIX/secrets/mcp-token)
DONE
