# Dani gateway

Your Dani chief-of-staff as a 24/7 Telegram bot, on any Linux VM, in one command.

The bot answers, remembers you, and runs real tasks (search, code, files) through
the Dani free model stack. No paid accounts. A local MCP endpoint lets desktop
apps pair with the same brain.

## Install (fresh Ubuntu/Debian VM, x86_64)

```bash
curl -fsSL https://raw.githubusercontent.com/somdipto/dani-alexa/main/install.sh | bash
```

The installer asks for one thing: a Telegram bot token from
[@BotFather](https://t.me/BotFather) (`/newbot`, copy the token). Non-interactive:

```bash
TELEGRAM_BOT_TOKEN=123:abc bash install.sh
```

When it finishes, everything is already running and self-tested (model runtime,
agent runtime, MCP health, and a real agent round-trip). Message your bot on
Telegram - it replies.

## What you get

| Piece | Where | Port |
|---|---|---|
| dani-free model runtime | `~/.dani/bin/dani-free` | 4190 |
| opencode agent runtime | `~/.dani/bin/opencode` | 4199 |
| Telegram gateway | `~/.dani/app/src/telegram-main.js` | - |
| MCP endpoint (`/healthz`, `/mcp`, pairing) | `~/.dani/app/src/http.js` | 8788 |

Everything lives in `~/.dani`. Secrets are `0600` in `~/.dani/secrets`.
State (pairing, memory, task journal) in `~/.dani/state`.

## Manage

```bash
~/.dani/bin/dani-status   # is it up, is it paired
~/.dani/bin/dani-down     # stop
~/.dani/bin/dani-up       # start
tail -f ~/.dani/logs/gateway.log
```

With systemd (default when available) it is a user service:
`systemctl --user status dani-gateway`. For boot persistence:
`loginctl enable-linger $USER`.

## Pairing a desktop app

`POST /pairing/code` issues a 6-digit code; the user sends it to the bot;
`GET /pairing/status` flips to paired. MCP tools: `delegate_task`,
`task_status`, `task_result`, `remember` (Bearer token in
`~/.dani/secrets/mcp-token`).

## Update

Re-run the installer. Config, secrets and state survive; binaries and the
gateway source are refreshed.

## Uninstall

```bash
~/.dani/bin/dani-down && rm -rf ~/.dani ~/.config/systemd/user/dani-gateway.service
```

## Dev

```bash
node --test            # gateway tests
bash -n install.sh     # installer syntax
```
