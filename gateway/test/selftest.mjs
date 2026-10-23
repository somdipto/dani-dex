// Smoke test: full agent round-trip through the local opencode server.
// Exits 0 and prints the answer when the agent replies, non-zero otherwise.
const base = (process.env.DANI_OPENCODE_BASE_URL ?? "http://127.0.0.1:4199").replace(/\/$/, "");

async function api(path, body) {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`opencode ${path}: ${res.status}`);
  return res.json();
}

const session = await api("/session", {});
const sid = session.id ?? session.sessionID;
await api(`/session/${sid}/message`, { parts: [{ type: "text", text: "Reply with exactly: pong" }] });

const deadline = Date.now() + 180000;
let answer = "";
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const msgs = await api(`/session/${sid}/message`);
  const list = Array.isArray(msgs) ? msgs : msgs.messages ?? [];
  let busy = false;
  for (const m of list) {
    const parts = m.parts ?? m.message?.parts ?? [];
    for (const p of parts) {
      if (p.type === "tool" && !["completed", "error"].includes(p.state?.status)) busy = true;
      if (p.type === "text" && p.text) answer = p.text;
    }
    if ((m.info ?? m).role === "assistant" && !((m.info ?? m).finish ?? "done")) busy = true;
  }
  const last = [...list].reverse().find((m) => ((m.info ?? m).role === "assistant"));
  const finish = last ? (last.info ?? last).finish : null;
  if (answer && !busy && (finish || (last?.info ?? last)?.time?.completed || finish !== null)) break;
}
await fetch(`${base}/session/${sid}`, { method: "DELETE" }).catch(() => {});
if (!answer) { console.error("no answer from agent"); process.exit(1); }
console.log(answer.trim());

// Env audit: the services must not inherit this shell's environment. On Linux,
// read each live service's /proc environ and assert only its curated set is
// present. Skips quietly off Linux or when a service is not running.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const DANI_CUA_PORT = process.env.DANI_CUA_PORT ?? "4201";

if (process.platform === "linux") {
  const BASE = ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TZ"];
  const ALLOWED = {
    "dani-free start": [...BASE],
    "opencode serve": [...BASE, "OPENCODE_CONFIG"],
    "telegram-main": [...BASE, "TELEGRAM_BOT_TOKEN_FILE", "DANI_OPENCODE_BASE_URL", "DANI_JOURNAL", "DANI_MEMORY", "DANI_PAIRING", "DANI_TELEGRAM_STATE", "DANI_TASTE", "DANI_INBOX", "DANI_PENDING", "DANI_WATCHES"],
    "src/http.js": [...BASE, "PORT", "MCP_AUTH_TOKEN", "DANI_OPENCODE_BASE_URL", "DANI_JOURNAL", "DANI_MEMORY", "DANI_PAIRING", "DANI_CUA_BASE_URL", "DANI_PLAN", "DANI_CARTESIA_STATE", "CARTESIA_KEY_FILE", "DANI_MCP_HOST"],
    "cua-driver serve": [...BASE, "DISPLAY", "XDG_RUNTIME_DIR", "CUA_DRIVER_EMBEDDED", "CUA_DRIVER_RS_TELEMETRY_ENABLED", "CUA_DRIVER_RS_UPDATE_CHECK"],
    "opencode-cua": [...BASE, "OPENCODE_CONFIG", "XDG_DATA_HOME"],
    "src/heartbeat.js": [...BASE, "TELEGRAM_BOT_TOKEN_FILE", "DANI_PAIRING", "DANI_JOBS", "DANI_MCP_URL", "DANI_MCP_TOKEN_FILE", "DANI_TASTE"],
  };
  let checked = 0;
  const leaks = [];
  for (const [pattern, allowed] of Object.entries(ALLOWED)) {
    let pid = "";
    let names = null;
    const realPattern = pattern === "opencode-cua" ? `opencode serve --port ${DANI_CUA_PORT}` : pattern;
    let pids = [];
    try { pids = execSync(`pgrep -f '${realPattern}'`).toString().split("\n").filter(Boolean); } catch { continue; }
    // pgrep -f also matches its own shell wrapper; only accept real service pids
    for (const p of pids) {
      try {
        const cmd = readFileSync(`/proc/${p}/cmdline`).toString();
        if (/pgrep|sh\0-c/.test(cmd)) continue;
        names = readFileSync(`/proc/${p}/environ`).toString().split("\0").filter(Boolean).map((kv) => kv.split("=")[0]);
        pid = p;
        break;
      } catch { /* process vanished; try the next */ }
    }
    if (!names) continue;
    const extra = names.filter((n) => !allowed.includes(n));
    if (extra.length) leaks.push(`${pattern} (pid ${pid}): ${extra.join(",")}`);
    checked++;
  }
  if (leaks.length) { console.error("ENV LEAK:\n" + leaks.join("\n")); process.exit(1); }
  console.log(`env audit ok (${checked} services checked)`);
} else {
  console.log("env audit skipped (not Linux)");
}
