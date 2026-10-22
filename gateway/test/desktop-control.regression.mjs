// Whole-PC control regression (virtual desktop). Needs scripts/desktop-up.sh running. Run: node test/desktop-control.regression.mjs
import { execFileSync, spawn } from "node:child_process"; import { readFileSync, readFileSync as rf, existsSync, writeFileSync } from "node:fs"; import { homedir } from "node:os";
import test from "node:test"; import assert from "node:assert/strict";
const D = homedir() + "/.dani/bin/cua-driver";
const envf = readFileSync(homedir() + "/.dani/run/desktop.env", "utf8");
const dbus = /DBUS_SESSION_BUS_ADDRESS='?([^';]+)/.exec(envf)?.[1];
const ENV = { PATH: process.env.PATH, HOME: process.env.HOME, DISPLAY: ":99", DBUS_SESSION_BUS_ADDRESS: dbus, GNOME_ACCESSIBILITY: "1", NO_AT_BRIDGE: "0" };
const call = (t, a = {}) => JSON.parse(execFileSync(D, ["call", t, JSON.stringify(a)], { env: ENV, timeout: 20000 }).toString());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wins = (title) => call("list_windows").windows.filter((w) => w.pid && (!title || w.title === title));
async function waitWin(title, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { const w = wins(title)[0]; if (w) return w; await sleep(300); } throw new Error("window not found: " + title); }
const launch = (args) => { const p = spawn("zenity", args, { env: ENV, stdio: ["ignore", "pipe", "ignore"] }); let out = ""; p.stdout.on("data", (d) => (out += d)); p.done = new Promise((r) => p.on("exit", () => r(out.trim()))); return p; };
const tree = (w) => call("get_window_state", { pid: w.pid, window_id: w.window_id });
const el = (t, label, role) => t.elements.find((e) => (!label || e.label === label) && (!role || e.role === role));

test("1 screen read: tree of a native window has its known labels and is not degraded", { timeout: 30000 }, async () => {
  const p = launch(["--entry", "--title=T1", "--text=name"]); const w = await waitWin("T1"); const t = tree(w);
  assert.ok(!t.degraded, "AT-SPI degraded: " + t.degraded_reason); assert.ok(el(t, "OK", "push button") && el(t, "Cancel")); p.kill();
});
test("2 mouse/keyboard: type into a field by element and press OK, value comes back", { timeout: 30000 }, async () => {
  const p = launch(["--entry", "--title=T2", "--text=name"]); const w = await waitWin("T2"); let t = tree(w);
  const field = t.elements.find((e) => e.role === "text"); call("click", { pid: w.pid, window_id: w.window_id, element_token: field.element_token });
  call("type_text", { pid: w.pid, window_id: w.window_id, element_token: field.element_token, text: "Dani" });
  t = tree(w); call("click", { pid: w.pid, window_id: w.window_id, element_token: el(t, "OK").element_token });
  assert.equal(await p.done, "Dani");
});
test("3 app launch: launcher returns a window within 10s and the window can be closed", { timeout: 30000 }, async () => {
  const p = launch(["--info", "--title=T3", "--text=hello"]); const w = await waitWin("T3"); assert.ok(w.window_id); p.kill(); await sleep(500); assert.equal(wins("T3").length, 0);
});
test("5 window switching: two windows listed, focus each by title", { timeout: 30000 }, async () => {
  const a = launch(["--info", "--title=WA", "--text=a"]), b = launch(["--info", "--title=WB", "--text=b"]); const wa = await waitWin("WA"), wb = await waitWin("WB");
  call("bring_to_front", { pid: wa.pid, window_id: wa.window_id }); await sleep(500); assert.ok(wins("WA").length && wins("WB").length);
  call("bring_to_front", { pid: wb.pid, window_id: wb.window_id }); a.kill(); b.kill();
});

test("4 file dialog: native chooser takes a typed path and returns the picked file", { timeout: 40000 }, async () => {
  writeFileSync("/tmp/pick-me.txt", "hi"); const p = launch(["--file-selection", "--title=FD"]); const w = await waitWin("FD"); const a = { pid: w.pid, window_id: w.window_id, delivery_mode: "foreground" };
  call("bring_to_front", { pid: w.pid, window_id: w.window_id }); await sleep(500);
  call("hotkey", { ...a, keys: ["ctrl", "l"] }); await sleep(300); call("type_text", { ...a, text: "/tmp/pick-me.txt" }); await sleep(300); call("press_key", { ...a, key: "Return" });
  assert.equal(await p.done, "/tmp/pick-me.txt");
});
test("6 recovery: a second identical desktop failure returns a recovery note with the window list", { timeout: 30000 }, async () => {
  const bridgeToken = readFileSync(homedir() + "/.dani/secrets/bridge-token", "utf8").trim(); const app = "rec" + Date.now();
  const go = async () => { const r = await fetch("http://127.0.0.1:8790", { method: "POST", headers: { authorization: "Bearer " + bridgeToken }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "desktop_call", arguments: { app, tool: "click", args: '{"element_token":"bogus:1"}' } } }) }); return (await r.json()).result; };
  const one = await go(), two = await go();
  assert.ok(one.isError && !one.content[0].text.includes("RECOVERY")); assert.ok(two.isError && two.content[0].text.includes("RECOVERY"));
});
