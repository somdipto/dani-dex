#!/usr/bin/env node
// Browser bridge: a stdio MCP server that lets a Dani-Dex agent drive the user's
// logged-in cloud browser. One browser lease per application (the `app` argument),
// capped so other agents keep their leases. Every call is logged without field
// values. Passwords never pass through here: browser_fill_saved asks the vault to
// type them straight into the page, and cards and SSNs are refused.
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { localCall, closeAllLocal } from "./browser-local.mjs";
const LOCAL = process.env.BRIDGE_LOCAL === "1";

const MAX_LEASES = Number(process.env.BRIDGE_MAX_LEASES ?? 3);
const LOG = process.env.BRIDGE_LOG ?? join(homedir(), ".dani", "logs", "browser-bridge.log");
const CONFIG = process.env.BRIDGE_CONFIG ?? "";
const MAX_OUT = 12000;
mkdirSync(join(LOG, ".."), { recursive: true });
const leases = new Map(); // app -> { lease, tab }

const log = (o) => { try { appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n"); } catch {} };
const run = (args) => new Promise((res, rej) =>
  execFile("tools", args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (e, so, se) =>
    e ? rej(new Error((se || e.message).trim().slice(0, 600))) : res(so)));
const json = async (args) => JSON.parse(await run([...args, "--json"]));
const clip = (s) => { s = typeof s === "string" ? s : JSON.stringify(s); return s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n[truncated]" : s; };

async function leaseFor(app) {
  if (!app || !/^[\w .:-]{1,60}$/.test(app)) throw new Error("app is required: a short name for the application, e.g. 'google-for-startups'");
  const have = leases.get(app);
  if (have) return have;
  if (leases.size >= MAX_LEASES) throw new Error(`lease cap reached (${MAX_LEASES}): call browser_release for a finished app first`);
  const a = ["cloud_browser_scheduler", "acquire", "--mode", "read", "--task-description", `Dani-Dex agent: ${app}`];
  if (CONFIG) a.push("--config", CONFIG);
  const r = await json(a);
  const l = { lease: r.lease_id, tab: r.tab_id };
  leases.set(app, l);
  log({ ev: "lease", app, lease: l.lease, config: r.config });
  return l;
}

const S = (props, req) => ({ type: "object", properties: props, required: req, additionalProperties: false });
const APP = { type: "string", description: "Short name of the application you are working on (one per application)" };
const DESKTOP_OK = ["get_accessibility_tree", "get_window_state", "list_windows", "list_apps", "get_screen_size", "bring_to_front", "launch_app", "click", "double_click", "drag", "type_text", "press_key", "hotkey", "scroll", "invoke_menu"];
const LAUNCH_OK = (process.env.DANI_LAUNCH_ALLOW ?? "google-chrome,zenity,nautilus,xmessage,gedit,libreoffice").split(",");
const deskFails = new Map();
async function desktopCall(a) {
  const key = a.app + ":" + a.tool;
  try { const r = await desktopCallRaw(a); if (/"refusal"|"status": "refused"|_unavailable|^Missing required|no such window|not found/i.test(String(r).slice(0, 400))) throw new Error(String(r).slice(0, 400).trim()); deskFails.delete(key); return r; }
  catch (e) {
    const n = (deskFails.get(key) ?? 0) + 1; deskFails.set(key, n);
    if (n < 2) throw e;
    let wins = ""; try { wins = JSON.stringify(JSON.parse(await desktopCallRaw({ ...a, tool: "list_windows", args: "{}" })).windows.filter((w) => w.pid).map((w) => ({ pid: w.pid, window_id: w.window_id, title: w.title }))); } catch {}
    throw new Error(`${e.message}\n[RECOVERY: ${n} failures in a row for ${a.tool}. Windows now: ${wins || "unknown"}. Re-run get_window_state on the right window for fresh element tokens, call bring_to_front on it, or press_key Escape (foreground) to close a stray dialog. Do not repeat the same call.]`);
  }
}
async function desktopCallRaw(a) {
  if (!DESKTOP_OK.includes(a.tool)) throw new Error("tool not allowed");
  let args = {}; try { args = a.args ? JSON.parse(a.args) : {}; } catch { throw new Error("args must be a JSON object string"); }
  if (a.tool === "launch_app" && !LAUNCH_OK.includes(String(args.name ?? ""))) throw new Error("launch_app name must be one of: " + LAUNCH_OK.join(", "));
  const { execFile } = await import("node:child_process"); const { homedir } = await import("node:os");
  return await new Promise((res, rej) => execFile(homedir() + "/.dani/bin/cua-driver", ["call", a.tool, JSON.stringify(args)], { timeout: 20000, maxBuffer: 4e6, env: { PATH: process.env.PATH, HOME: process.env.HOME, DISPLAY: process.env.DANI_DISPLAY || ":99" } }, (e, o, er) => e ? rej(new Error((er || e.message).slice(0, 300))) : res(o.slice(0, 6000))));
}
const TOOLS = [
  { name: "browser_open", description: "Open a URL in the logged-in cloud browser and return the page as an accessibility tree with [ref=nX] markers.", inputSchema: S({ app: APP, url: { type: "string" } }, ["app", "url"]) },
  { name: "browser_read", description: "Re-read the current page (fresh refs).", inputSchema: S({ app: APP }, ["app"]) },
  { name: "browser_find", description: "Find elements by plain-language query; returns refs.", inputSchema: S({ app: APP, query: { type: "string" } }, ["app", "query"]) },
  { name: "browser_click", description: "Click an element by ref.", inputSchema: S({ app: APP, ref: { type: "string" } }, ["app", "ref"]) },
  { name: "browser_fill", description: "Type a non-secret value into a field by ref (names, answers, URLs). Never use for passwords.", inputSchema: S({ app: APP, ref: { type: "string" }, value: { type: "string" } }, ["app", "ref", "value"]) },
  { name: "browser_select", description: "Choose an option in a native select by ref.", inputSchema: S({ app: APP, ref: { type: "string" }, value: { type: "string" } }, ["app", "ref", "value"]) },
  { name: "browser_press", description: "Press a key: enter, tab, escape, up, down, pageup, pagedown, home, end.", inputSchema: S({ app: APP, key: { type: "string" } }, ["app", "key"]) },
  { name: "browser_upload", description: "Upload a local file into a file input by ref.", inputSchema: S({ app: APP, ref: { type: "string" }, file_path: { type: "string" } }, ["app", "ref", "file_path"]) },
  { name: "browser_fill_saved", description: "Have the vault type a saved login password or username, address or phone into a field. You never see the value. Cards and SSNs are refused.", inputSchema: S({ app: APP, ref: { type: "string" }, kind: { type: "string", enum: ["login", "address", "phone"] }, name: { type: "string", description: "Vault item name" }, key: { type: "string", description: "password, username, line1, city, state, zip, country, number" } }, ["app", "ref", "kind", "name", "key"]) },
  { name: "browser_screenshot", description: "Save a PNG of the page for the human operator (you cannot view it). Use browser_read to see the page.", inputSchema: S({ app: APP }, ["app"]) },
  { name: "browser_captcha_checkbox", description: "Click a plain 'I am not a robot' checkbox like a normal user (real mouse click, then wait). Never use for image or puzzle challenges: if one appears this reports a wall and you must stop.", inputSchema: S({ app: APP }, ["app"]) },
  { name: "desktop_call", description: "Fallback for what the page tools cannot do (native file pickers, OS dialogs, non-browser windows). Text-only, no screenshots. Flow: list_windows, then get_window_state {pid,window_id} to get elements, then click/type_text with the element_token from that result (bare element_index is refused). Also launch_app {name}, bring_to_front, double_click, drag, press_key, hotkey, scroll, invoke_menu, get_screen_size, list_apps. args is a JSON object string.", inputSchema: S({ app: APP, tool: { type: "string", enum: DESKTOP_OK }, args: { type: "string" } }, ["app", "tool"]) },
  { name: "browser_release", description: "Release the browser for this application when it is finished.", inputSchema: S({ app: APP }, ["app"]) },
];

async function call(name, a) {
  const app = a.app;
  if (name === "desktop_call") return clip(await desktopCall(a));
  if (LOCAL) { if (!app || !/^[\w .:-]{1,60}$/.test(app)) throw new Error("app is required"); return clip(await localCall(name, a)); }
  if (name === "browser_release") {
    const l = leases.get(app); if (!l) return "no lease";
    await run(["cloud_browser_scheduler", "release", "--lease-id", l.lease]); leases.delete(app); log({ ev: "release", app }); return "released";
  }
  const l = await leaseFor(app);
  const base = ["cloud_browser"];
  const L = ["--lease-id", l.lease];
  const T = ["--tab-id", String(l.tab)];
  switch (name) {
    case "browser_open": {
      if (!/^https?:\/\//.test(a.url)) throw new Error("url must start with http or https");
      const r = await json([...base, "navigate-and-read", ...L, ...T, "--url", a.url]); return clip(r);
    }
    case "browser_read": return clip(await json([...base, "read-page", ...L, ...T]));
    case "browser_find": return clip(await json([...base, "find", ...L, ...T, "--query", a.query]));
    case "browser_click": return clip(await json([...base, "click", ...L, "--ref", a.ref]));
    case "browser_fill": return clip(await json([...base, "form-input", ...L, "--ref", a.ref, "--value", a.value]));
    case "browser_select": return clip(await json([...base, "select-option", ...L, "--ref", a.ref, "--value", a.value]));
    case "browser_press": return clip(await json([...base, "key-press", ...L, ...T, "--key", a.key]));
    case "browser_upload": return clip(await json([...base, "upload-file", ...L, "--ref", a.ref, "--file-path", a.file_path]));
    case "browser_fill_saved": {
      if (!["login", "address", "phone"].includes(a.kind)) throw new Error("only login, address and phone items can be filled here");
      return clip(await json(["vault", "fill", "--lease-id", l.lease, "--kind", a.kind, "--name", a.name, "--key", a.key, "--field-ref", a.ref, "--return-channel", "none"]));
    }
    case "browser_screenshot": { await json([...base, "screenshot", ...L, ...T, "--save"]); return "Screenshot saved for the operator. You cannot view images, so do not open it; use browser_read to see the page."; }
    default: throw new Error("unknown tool " + name);
  }
}

async function handle(m) {
  const { id, method, params } = m;
  if (id === undefined) return null;
  if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "dani-browser-bridge", version: "0.1.0" } } };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    const { name, arguments: a = {} } = params ?? {};
    const t0 = Date.now();
    try {
      const text = await call(name, a);
      log({ ev: "call", tool: name, app: a.app, ref: a.ref, valueLen: a.value?.length, ms: Date.now() - t0, ok: true });
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (e) {
      log({ ev: "call", tool: name, app: a.app, ms: Date.now() - t0, ok: false, err: String(e.message).slice(0, 200) });
      return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: String(e.message) }] } };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } };
}
const release = async () => { closeAllLocal(); for (const [, l] of leases) await run(["cloud_browser_scheduler", "release", "--lease-id", l.lease]).catch(() => {}); };

if (process.env.BRIDGE_PORT) {
  // HTTP mode: runs as its own process so the tool credentials stay out of the
  // agent runtime's curated environment. Bearer token from a 0600 file.
  const { createServer } = await import("node:http");
  const { readFileSync } = await import("node:fs");
  const token = readFileSync(process.env.BRIDGE_TOKEN_FILE, "utf8").trim();
  createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let body = ""; for await (const c of req) body += c;
    let m; try { m = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    const r = await handle(m);
    if (!r) { res.writeHead(202).end(); return; }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(r));
  }).listen(Number(process.env.BRIDGE_PORT), "127.0.0.1");
  const bye = async () => { await release(); process.exit(0); };
  process.on("SIGTERM", bye); process.on("SIGINT", bye);
} else {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => { let m; try { m = JSON.parse(line); } catch { return; } const r = await handle(m); if (r) process.stdout.write(JSON.stringify(r) + "\n"); });
  const bye = async () => { await release(); process.exit(0); };
  process.on("SIGTERM", bye); process.on("SIGINT", bye); rl.on("close", bye);
}
