import { finishTask } from "./receipts.js";
import http from "node:http";
import { readFileSync } from "node:fs";
import { TaskStore } from "./store.js";
import { PairingStore } from "./pairing-store.js";
import { Memory } from "./memory.js";
import { OpenCodeExecutor } from "./executor-opencode.js";
import { resumeInterrupted } from "./resume.js";
import { ComputerUseWorker } from "./computer-use.js";
import { voiceSession } from "./voice-endpoint.js";

// MCP + control server: one tool/approval contract, two front doors (Amazon add-on, Telegram chief).
const token = process.env.MCP_AUTH_TOKEN;
const store = new TaskStore(process.env.DANI_JOURNAL ?? "./tasks.jsonl");
const pairing = new PairingStore(process.env.DANI_PAIRING ?? "./pairing.json");
const memory = new Memory(process.env.DANI_MEMORY ?? "./memory.jsonl");
const executor = new OpenCodeExecutor({ baseUrl: process.env.DANI_OPENCODE_BASE_URL, memory });
const computer = new ComputerUseWorker({ baseUrl: process.env.DANI_CUA_BASE_URL });
const PORT = Number(process.env.PORT ?? 8788);
async function runComputerTask(id) {
  const t = store.get(id);
  if (!t) return;
  store.update(id, { state: "running" }, "computer worker started");
  try {
    const { answer, toolsUsed } = await computer.run(t.input.task, { onTool: (tool) => store.log(id, `used ${tool}`) });
    finishTask(store, id, answer, toolsUsed);
  } catch (err) {
    store.update(id, { state: "failed", error: String(err?.message ?? err) }, "failed");
  }
}
function runTask(id) {
  const t = store.get(id);
  if (!t) return;
  return t.kind === "computer" ? runComputerTask(id) : executor.run(store, id);
}
const resumed = resumeInterrupted(store, runTask);
if (resumed.length) console.log(`[resume] re-kicked ${resumed.length} interrupted task(s): ${resumed.map((i) => i.slice(0, 8)).join(", ")}`);

const TOOLS = [
  { name: "delegate_task", description: "Hand a real task to Dani. Returns a task id; the result comes back via task_result.", inputSchema: { type: "object", properties: { task: { type: "string" } }, required: ["task"] } },
  { name: "task_status", description: "Check a task's state and event log.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "task_result", description: "Read a finished task's answer and audit trail.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "remember", description: "Save a durable fact about the chief.", inputSchema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] } },
  { name: "computer_task", description: "Drive the real desktop: open apps, click, type, read windows. Use when a task needs the actual computer, not just an answer.", inputSchema: { type: "object", properties: { task: { type: "string" } }, required: ["task"] } },
];

function callTool(name, args) {
  if (name === "delegate_task") {
    if (!executor.available) return { error: "agent runtime not connected" };
    const id = store.create("agent", { task: String(args.task).slice(0, 8000) });
    store.log(id, "accepted from mcp");
    queueMicrotask(() => executor.run(store, id));
    return { id: id.slice(0, 8) };
  }
  if (name === "task_status" || name === "task_result") {
    const t = store.findByPrefix(String(args.id ?? ""));
    if (!t) return { error: "no task with that id" };
    if (name === "task_status") return { state: t.state, events: t.events.map((e) => e.message) };
    if (t.state !== "done") return { state: t.state, error: t.state === "failed" ? t.error : "not finished" };
    return { state: "done", answer: t.result?.answer, tools: (t.result?.toolsUsed ?? []).map((u) => u.tool) };
  }
  if (name === "computer_task") {
    if (!computer.available) return { error: "computer use not available on this install" };
    const id = store.create("computer", { task: String(args.task).slice(0, 4000) });
    store.log(id, "accepted from mcp");
    queueMicrotask(() => runComputerTask(id));
    return { id: id.slice(0, 8) };
  }
  if (name === "remember") { memory.add(String(args.fact).slice(0, 500)); return { ok: true }; }
  return { error: "unknown tool" };
}

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function mcp(msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    // a JSON-RPC response or malformed object: nothing to answer
    return msg && ("result" in msg || "error" in msg) ? null : rpcErr(msg?.id, -32600, "invalid request");
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined;
  if (isNotification) return null; // notifications/* are accepted with 202, never answered
  if (method === "initialize") {
    const asked = params?.protocolVersion;
    const version = SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0];
    return { jsonrpc: "2.0", id, result: { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "dani", title: "Dani", version: "1.0.0" }, instructions: "Dani is a personal agent. Use delegate_task for real work, then task_status/task_result." } };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    if (!TOOLS.some((t) => t.name === params?.name)) return rpcErr(id, -32602, `unknown tool: ${params?.name}`);
    const out = callTool(params.name, params?.arguments ?? {});
    const isError = Boolean(out && typeof out === "object" && out.error);
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out) }], isError } };
  }
  return rpcErr(id, -32601, "method not found");
}

// DNS-rebinding guard (spec 2025-11-25, Streamable HTTP): reject any
// browser Origin that is not loopback or explicitly allowed.
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients send none
  const allowed = (process.env.DANI_MCP_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  try {
    const u = new URL(origin);
    return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || allowed.includes(origin);
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url === "/healthz") return send(200, { ok: true, executor: executor.available, paired: Boolean(pairing.chief()) });
  const auth = req.headers.authorization;
  if (!token || auth !== `Bearer ${token}`) return send(401, { error: "unauthorized" });
  if (req.url === "/pairing/status") return send(200, { paired: Boolean(pairing.chief()), chief: pairing.chief() ? { pairedAt: pairing.chief().pairedAt } : null });
  if (req.url === "/pairing/code" && req.method === "POST") {
    const { code, expiresAt } = pairing.issueCode();
    return send(200, { code, expiresAt });
  }
  if (req.url === "/voice/session" && req.method === "POST") {
    try {
      const r = await voiceSession({ planPath: process.env.DANI_PLAN, keyFile: process.env.CARTESIA_KEY_FILE, statePath: process.env.DANI_CARTESIA_STATE });
      return send(r.code, r.body);
    } catch { return send(502, { error: "voice provider unavailable" }); }
  }
  if (req.url === "/mcp") {
    if (!originOk(req)) return send(403, rpcErr(null, -32000, "forbidden origin"));
    if (req.method === "GET" || req.method === "DELETE") { res.setHeader("allow", "POST"); return send(405, rpcErr(null, -32000, "this endpoint offers no SSE stream or session teardown")); }
    if (req.method !== "POST") return send(405, rpcErr(null, -32000, "method not allowed"));
    const pv = req.headers["mcp-protocol-version"];
    if (pv && !SUPPORTED_VERSIONS.includes(pv)) return send(400, rpcErr(null, -32600, `unsupported MCP-Protocol-Version: ${pv}`));
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return send(400, rpcErr(null, -32700, "parse error")); }
    if (Array.isArray(parsed)) return send(400, rpcErr(null, -32600, "batching is not supported"));
    const out = mcp(parsed);
    if (out === null) { res.writeHead(202); return res.end(); }
    return send(200, out);
  }
  return send(404, { error: "not found" });
});
server.listen(PORT, process.env.DANI_MCP_HOST ?? "127.0.0.1", () => console.log(`dani mcp listening on :${PORT}`));
