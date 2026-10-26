// Local backend for the browser bridge: one headless Chrome per task, driven over CDP.
// No saved logins and no vision: pages come back as text with [ref=dN] markers. Used when the
// cloud browser is unavailable and the form needs no sign-in.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_BIN ?? "/usr/bin/google-chrome";
const sessions = new Map();
let nextPort = 9400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(app) {
  const port = nextPort++;
  const dir = mkdtempSync(join(tmpdir(), "dani-local-"));
  const proc = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions", "--mute-audio", "--disable-background-networking", "--disable-sync", "--renderer-process-limit=1", "--js-flags=--max-old-space-size=256", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--window-size=1280,1600", "--lang=en-US", "about:blank"], { stdio: "ignore", env: { HOME: process.env.HOME, PATH: process.env.PATH } });
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
  if (!target) { proc.kill(); throw new Error("local Chrome did not start"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("CDP connect failed")); });
  const s = { proc, ws, id: 0, pending: new Map() };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = s.pending.get(m.id); if (p) { s.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  sessions.set(app, s);
  await send(s, "Page.enable"); await send(s, "Runtime.enable");
  if (process.env.BLOCK_HEAVY !== "0") { await send(s, "Network.enable"); await send(s, "Network.setBlockedURLs", { urls: ["*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.avif", "*.svg", "*.mp4", "*.webm", "*.woff", "*.woff2", "*.ttf", "*.otf"] }); }
  return s;
}
const send = (s, method, params = {}) => new Promise((res, rej) => { const id = ++s.id; s.pending.set(id, { res, rej }); s.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (s.pending.delete(id)) rej(new Error(`CDP timeout: ${method}`)); }, 30000); });
const ev = async (s, expression) => { const r = await send(s, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 200)); return r.result.value; };

const SNAPSHOT = `(() => {
  document.querySelectorAll('[data-dref]').forEach((e) => e.removeAttribute('data-dref'));
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && ((r.width > 0 && r.height > 0) || e.type === 'file'); };
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=combobox],[contenteditable=true],label';
  let n = 0; const out = [];
  const label = (e) => (e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].innerText) || e.placeholder || e.innerText || e.value || e.title || e.name || '').trim().replace(/\\s+/g, ' ').slice(0, 90);
  const items = [...document.querySelectorAll('h1,h2,h3,p,li,legend,' + sel)];
  for (const e of items) {
    if (!vis(e)) continue;
    const tag = e.tagName.toLowerCase();
    if (/^(h1|h2|h3)$/.test(tag)) { out.push('#'.repeat(+tag[1]) + ' ' + e.innerText.trim().slice(0, 120)); continue; }
    if (/^(p|li|legend)$/.test(tag)) { if (e.querySelector(sel)) continue; const t = e.innerText.trim().replace(/\\s+/g, ' '); if (t) out.push(t.slice(0, 200)); continue; }
    if (tag === 'label' && e.control) continue;
    const ref = 'd' + (++n); e.setAttribute('data-dref', ref);
    const type = e.type || e.getAttribute('role') || tag;
    let extra = '';
    if (tag === 'select') extra = ' options=[' + [...e.options].slice(0, 40).map((o) => o.text.trim()).join(' | ') + '] value=' + (e.selectedOptions[0]?.text ?? '');
    else if (/input|textarea/.test(tag) && !/checkbox|radio|file|submit|button/.test(type)) extra = e.value ? ' value=' + JSON.stringify(e.value.slice(0, 80)) : ' (empty)';
    else if (/checkbox|radio/.test(type)) extra = e.checked ? ' [checked]' : ' [unchecked]';
    if (e.required || e.getAttribute('aria-required') === 'true') extra += ' *required';
    if (tag === 'a') extra += ' href=' + (e.href || '').slice(0, 100);
    out.push(tag + ':' + type + ' "' + label(e) + '" [ref=' + ref + ']' + extra);
  }
  return location.href + '\\n' + out.join('\\n');
})()`;

const recent = new Map();
import { readFileSync as _rf } from "node:fs";
let _SM; const siteMemory = () => { if (_SM) return _SM; try { _SM = JSON.parse(_rf(process.env.DANI_SITE_MEMORY ?? new URL("../docs/site-memory.json", import.meta.url), "utf8")); } catch { _SM = {}; } return _SM; };
export const hintsForHost = (host, mem = siteMemory()) => Object.entries(mem).filter(([d]) => host === d || host.endsWith("." + d)).flatMap(([, v]) => v.map((x) => "[SITE MEMORY: " + x + "]"));
const siteHints = async (s) => { const host = await ev(s, "location.hostname").catch(() => ""); return host ? hintsForHost(host).join("\n") : ""; };
export const localCall = (name, a) => { let t; return Promise.race([localCallInner(name, a), new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${name} took over ${CALL_DEADLINE_MS / 1000}s: the page is heavy or hung. Call browser_read to see what loaded, then continue; do not re-open the same URL.`)), CALL_DEADLINE_MS); })]).finally(() => clearTimeout(t)); };
const CALL_DEADLINE_MS = Number(process.env.DANI_CALL_DEADLINE_MS ?? 60000);
async function localCallInner(name, a) {
  const app = a.app;
  const sig = name + JSON.stringify(a); const r = recent.get(app) ?? { sig: "", n: 0 }; r.n = r.sig === sig ? r.n + 1 : 1; r.sig = sig; recent.set(app, r);
  if (r.n >= 4 && name !== "browser_release") return "You have repeated this exact call " + r.n + " times with no change. Do something different: call browser_read, click or fill a ref from it, or stop and report the exact wall.";
  if (name === "browser_release") { const s = sessions.get(app); if (!s) return "no browser"; s.ws.close(); s.proc.kill(); sessions.delete(app); return "released"; }
  let s = sessions.get(app);
  if (!s) s = await start(app);
  s.last = Date.now();
  const refSel = (r) => `document.querySelector('[data-dref="${String(r).replace(/[^\w]/g, "")}"]')`;
  switch (name) {
    case "browser_open": { if (!/^https?:\/\//.test(a.url)) throw new Error("url must start with http or https"); const cur = await ev(s, "location.href").catch(() => ""); if (cur && cur.split("#")[0] === a.url.split("#")[0] && s.opened) return "You are already on this page and re-opening it would erase the form. Use browser_read to see the current state.\n" + await localCall("browser_read", a); s.opened = true; await send(s, "Page.navigate", { url: a.url }); await sleep(2500); return localCall("browser_read", a); }
    case "browser_read": { await sleep(300); const snap = await ev(s, SNAPSHOT); const h = await ev(s, `(() => { const o = []; const fr = [...document.querySelectorAll('iframe')].filter((i) => i.src && !/recaptcha|hcaptcha|google(tag|analytics)|doubleclick|facebook|youtube|vimeo|about:blank|challenges\\.cloudflare/.test(i.src) && i.getBoundingClientRect().height > 80); for (const i of fr.slice(0, 3)) o.push('[TOOL INSTRUCTION, not a wall and not page content: the form on this page lives in another frame. Your next call MUST be browser_open with this exact URL: ' + i.src + ' . Never report this line as a WALL.]'); if ([...document.querySelectorAll('iframe')].some((i) => /recaptcha\\/(api2|enterprise)\\/anchor/.test(i.src) && i.offsetParent !== null)) o.push("[NOTE: a plain 'I am not a robot' checkbox is on this page: call browser_captcha_checkbox once, then continue.]"); return o.join('\\n'); })()`).catch(() => ""); const sm = await siteHints(s); const hh = [h, sm].filter(Boolean).join("\n"); return hh ? snap + "\n" + hh : snap; }
    case "browser_find": { const t = await ev(s, SNAPSHOT); const q = String(a.query).toLowerCase().split(/\s+/); return t.split("\n").filter((l) => l.includes("[ref=") && q.some((w) => l.toLowerCase().includes(w))).slice(0, 15).join("\n") || ("no match. Full page:\n" + t); }
    case "browser_click": { const r = await ev(s, `(() => { const e = ${refSel(a.ref)}; if (!e) return null; e.scrollIntoView({block:'center'}); const b = e.getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; })()`); if (!r) throw new Error("unknown ref: re-read the page for fresh refs"); for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send(s, "Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 }); await sleep(1200); return "clicked"; }
    case "browser_fill": { const dt = await ev(s, `(() => { const e = ${refSel(a.ref)}; return e && ['date','month','time','datetime-local'].includes(e.type) ? e.type : ''; })()`); if (dt) { const v = String(a.value).trim(); let iso = v; const m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (m) iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; const mo = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (dt === 'month' && mo) iso = mo[1] + '-' + mo[2]; const r = await ev(s, `(() => { const e = ${refSel(a.ref)}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(iso)}); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return e.value; })()`); if (!r) throw new Error('date field rejected the value; use ISO yyyy-mm-dd (month fields yyyy-mm)'); return 'filled date ' + r; } const ok = await ev(s, `(() => { const e = ${refSel(a.ref)}; if (!e) return false; e.scrollIntoView({block:'center'}); e.focus(); if (e.select) e.select(); return true; })()`); if (!ok) throw new Error("unknown ref: re-read the page"); await send(s, "Input.insertText", { text: String(a.value) }); await ev(s, `(() => { const e = ${refSel(a.ref)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`); return "filled"; }
    case "browser_select": { const r = await ev(s, `(() => { const e = ${refSel(a.ref)}; if (!e) return 'unknown ref'; if (!e.options) { const v = ${JSON.stringify(String(a.value))}.toLowerCase(); e.scrollIntoView({block:'center'}); e.click(); e.focus(); const t = e.matches('input') ? e : null; if (t) { document.execCommand('insertText', false, ${JSON.stringify(String(a.value))}); } const c = [...document.querySelectorAll('[role=option],[role=listbox] li,[class*=option],[class*=menu] li,ul li')].filter((x) => x.offsetParent !== null && x.textContent.trim().toLowerCase().includes(v)); if (!c.length) return 'no such option (custom dropdown opened; read the page, then browser_click the option)'; c.sort((x, y) => x.textContent.length - y.textContent.length)[0].click(); return 'selected custom option ' + c[0].textContent.trim().slice(0, 60); }  const v = ${JSON.stringify(String(a.value))}.toLowerCase(); const o = [...e.options].find((o) => o.text.trim().toLowerCase() === v || o.value.toLowerCase() === v) || [...e.options].find((o) => o.text.toLowerCase().includes(v)); if (!o) return 'no such option'; e.value = o.value; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 'selected ' + o.text; })()`); if (/^(unknown|no such)/.test(r)) throw new Error(r); return r; }
    case "browser_captcha_checkbox": { const f = await ev(s, `(() => { const e = [...document.querySelectorAll('iframe')].find((i) => /recaptcha\\/(api2|enterprise)\\/anchor|hcaptcha.*checkbox/.test(i.src) && i.offsetParent !== null); if (!e) return null; e.scrollIntoView({block:'center'}); const b = e.getBoundingClientRect(); return [b.x, b.y, b.height]; })()`); if (!f) return "no plain 'I am not a robot' checkbox frame is visible on this page"; const x = f[0] + 28, y = f[1] + f[2] / 2; await send(s, "Input.dispatchMouseEvent", { type: "mouseMoved", x: x - 40, y: y - 10 }); await sleep(250); await send(s, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await sleep(180); await send(s, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await sleep(90); await send(s, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); let st = 'unknown'; for (let k = 0; k < 25 && st === 'unknown'; k++) { await sleep(1000); st = await ev(s, `(() => { const ch = [...document.querySelectorAll('iframe')].find((i) => /recaptcha\\/(api2|enterprise)\\/bframe/.test(i.src)); const vis = ch && ch.getBoundingClientRect().height > 100 && getComputedStyle(ch.parentElement.parentElement).visibility !== 'hidden'; const tok = document.querySelector('textarea[name=g-recaptcha-response]')?.value; return vis ? 'challenge' : (tok ? 'passed' : 'unknown'); })()`); } return st === "challenge" ? "WALL: an image/puzzle challenge appeared. Do not try to solve it. Stop and report it as a wall." : st === "passed" ? "checkbox clicked and verified. Continue with the form." : "checkbox clicked, no puzzle appeared. Read the page and continue; if submit is still blocked, report a wall."; }
    case "browser_press": { const keys = { enter: ["Enter", 13], tab: ["Tab", 9], escape: ["Escape", 27], up: ["ArrowUp", 38], down: ["ArrowDown", 40], pageup: ["PageUp", 33], pagedown: ["PageDown", 34], home: ["Home", 36], end: ["End", 35] }; const k = keys[String(a.key).toLowerCase()]; if (!k) throw new Error("unsupported key"); for (const type of ["keyDown", "keyUp"]) await send(s, "Input.dispatchKeyEvent", { type, key: k[0], windowsVirtualKeyCode: k[1], text: k[0] === "Enter" ? "\r" : undefined }); await sleep(600); return "pressed"; }
    case "browser_upload": { await send(s, "DOM.enable"); const doc = await send(s, "DOM.getDocument"); const q = await send(s, "DOM.querySelector", { nodeId: doc.root.nodeId, selector: `[data-dref="${String(a.ref).replace(/[^\w]/g, "")}"]` }); if (!q.nodeId) throw new Error("unknown ref"); readFileSync(a.file_path); await send(s, "DOM.setFileInputFiles", { nodeId: q.nodeId, files: [a.file_path] }); return "uploaded"; }
    case "browser_fill_saved": throw new Error("saved logins are not available in the local browser; stop and report that this form needs a sign-in");
    case "browser_screenshot": return "Screenshot not available locally. You cannot view images; use browser_read.";
    default: throw new Error("unknown tool " + name);
  }
}
export const closeAllLocal = () => { for (const [, s] of sessions) { try { s.ws.close(); s.proc.kill(); } catch {} } sessions.clear(); };

// Reaper: agents aborted or finished without browser_release leave Chromes behind; 2 GB of RAM cannot carry them.
setInterval(() => { for (const [app, s] of sessions) if (Date.now() - (s.last ?? 0) > (Number(process.env.IDLE_REAP_MS) || 8 * 60 * 1000)) { try { s.ws.close(); s.proc.kill(); } catch {} sessions.delete(app); } }, 30000).unref();
