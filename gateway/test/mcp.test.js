import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Spec 2025-11-25 Streamable HTTP conformance for the Dani MCP endpoint.
let proc, dir;
const PORT = 18788, URL_ = `http://127.0.0.1:${PORT}/mcp`, TOKEN = "t".repeat(32);
const H = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` };
const post = (body, headers = {}) => fetch(URL_, { method: "POST", headers: { ...H, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "dani-mcp-"));
  proc = spawn(process.execPath, ["src/http.js"], { env: { PATH: process.env.PATH, PORT: String(PORT), MCP_AUTH_TOKEN: TOKEN, DANI_JOURNAL: join(dir, "t.jsonl"), DANI_MEMORY: join(dir, "m.jsonl"), DANI_PAIRING: join(dir, "p.json"), DANI_OPENCODE_BASE_URL: "http://127.0.0.1:1" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/healthz`); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
after(() => { proc?.kill(); rmSync(dir, { recursive: true, force: true }); });

test("initialize negotiates 2025-11-25 and falls back for unknown versions", async () => {
  let r = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "1" } } })).json();
  assert.equal(r.result.protocolVersion, "2025-11-25");
  assert.ok(r.result.capabilities.tools);
  r = await (await post({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json();
  assert.equal(r.result.protocolVersion, "2025-11-25");
  r = await (await post({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
  assert.equal(r.result.protocolVersion, "2025-06-18");
});

test("notifications get 202 with no body; ping answers", async () => {
  const n = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(n.status, 202);
  assert.equal((await n.text()), "");
  const p = await (await post({ jsonrpc: "2.0", id: 9, method: "ping" })).json();
  assert.deepEqual(p.result, {});
});

test("tools/list exposes schemas; unknown tool is a protocol error; tool failure is isError", async () => {
  const l = await (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
  assert.ok(l.result.tools.length >= 3 && l.result.tools.every((t) => t.inputSchema?.type === "object"));
  const u = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nope", arguments: {} } })).json();
  assert.equal(u.error.code, -32602);
  const e = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "task_status", arguments: { id: "zzzzzzzz" } } })).json();
  assert.equal(e.result.isError, true);
});

test("transport rules: GET/DELETE 405, bad Origin 403, bad version 400, bad JSON 400, batch 400, no auth 401", async () => {
  assert.equal((await fetch(URL_, { method: "GET", headers: { ...H, accept: "text/event-stream" } })).status, 405);
  assert.equal((await fetch(URL_, { method: "DELETE", headers: H })).status, 405);
  assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "http://localhost:3000" })).status, 200);
  assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "1999-01-01" })).status, 400);
  assert.equal((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "2025-11-25" })).status, 200);
  assert.equal((await post("{not json")).status, 400);
  assert.equal((await post([{ jsonrpc: "2.0", id: 1, method: "ping" }])).status, 400);
  assert.equal((await fetch(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
});
