// Regression checks for computer-use walls found in real sites. Run: node test/computer-use.regression.mjs
// Starts a local fixture site (no network) and drives it through localCall like an agent would.
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { localCall, closeAllLocal } from "../src/browser-local.mjs";
const inner = `<form onsubmit="document.title='SENT';return false"><input name=email placeholder="Email"><button>Send</button></form>`;
const page = `<h1>Apply</h1><iframe src="/inner" width=400 height=200></iframe>
<label>Start<input type=date id=sd></label>
<label>Role<select id=n><option>Founder</option><option>CTO</option></select></label>
<div id=dd role=combobox tabindex=0 onclick="document.getElementById('m').style.display='block'">Country</div>
<ul id=m style="display:none"><li role=option onclick="document.getElementById('dd').textContent='India';this.parentElement.style.display='none'">India</li><li role=option>Peru</li></ul>`;
const srv = createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(q.url === "/inner" ? inner : page); }).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`; const app = "regress"; let ok = 0;
try {
  const t = await localCall("browser_open", { app, url: base + "/" });
  assert.match(t, /TOOL INSTRUCTION.*another frame.*\/inner/s, "frame hint missing"); ok++;
  const again = await localCall("browser_open", { app, url: base + "/" });
  assert.match(again, /already on this page/, "re-open guard"); ok++;
  const sel = t.split("\n").find((l) => /select/i.test(l) && l.includes("[ref="))?.match(/\[ref=(\w+)\]/)?.[1];
  assert.ok(sel, "native select ref"); assert.match(await localCall("browser_select", { app, ref: sel, value: "CTO" }), /selected CTO/); ok++;
  const dd = t.split("\n").find((l) => /Country/.test(l) && l.includes("[ref="))?.match(/\[ref=(\w+)\]/)?.[1];
  assert.ok(dd, "custom dropdown ref"); assert.match(await localCall("browser_select", { app, ref: dd, value: "India" }), /selected custom option India/); ok++;
  const dref = t.split("\n").find((l) => /date/i.test(l) && l.includes("[ref="))?.match(/\[ref=(\w+)\]/)?.[1];
  assert.ok(dref, "date ref"); assert.match(await localCall("browser_fill", { app, ref: dref, value: "27/06/2024" }), /filled date 2024-06-27/); ok++;
  const f = await localCall("browser_open", { app, url: base + "/inner" });
  const em = f.match(/Email.*?\[ref=(\w+)\]|\[ref=(\w+)\][^\n]*Email/s); assert.ok(em, "inner form reachable top-level"); ok++;
  let loop = ""; for (let i = 0; i < 5; i++) loop = await localCall("browser_find", { app, query: "zzz-nothing" });
  assert.match(loop, /repeated this exact call/); ok++;
  console.log(`computer-use regression: ${ok}/7 passed`);
} catch (e) { console.error("FAIL", e.message, `after ${ok} passed`); process.exitCode = 1; } finally { closeAllLocal(); srv.close(); }
