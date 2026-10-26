import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";

// One-shot reply watch: "when his next reply arrives, run this routine once,
// then end". Durable (survives restarts), always has a deadline, never
// recurs. States: active -> fired | expired | cancelled.
export class Watches {
  constructor(path) {
    this.path = path;
    this.items = [];
    if (path && existsSync(path)) {
      try { this.items = JSON.parse(readFileSync(path, "utf8")).items ?? []; } catch {}
    }
  }
  #save() {
    if (!this.path) return;
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify({ items: this.items.slice(-100) }));
    renameSync(tmp, this.path);
  }
  create({ chatId, routine, minutes }) {
    const m = Math.max(1, Math.min(7 * 24 * 60, Number(minutes) || 0));
    if (!routine?.trim() || !minutes) return null;
    const w = { id: randomBytes(4).toString("hex"), chatId, routine: routine.trim().slice(0, 1000), createdAt: new Date().toISOString(), deadline: new Date(Date.now() + m * 60_000).toISOString(), state: "active" };
    this.items.push(w);
    this.#save();
    return w;
  }
  #expire() {
    const now = Date.now();
    let changed = false;
    for (const w of this.items) if (w.state === "active" && Date.parse(w.deadline) <= now) { w.state = "expired"; changed = true; }
    if (changed) this.#save();
  }
  active(chatId) { this.#expire(); return this.items.filter((w) => w.state === "active" && (chatId == null || String(w.chatId) === String(chatId))); }
  // Claims the oldest active watch for this chat exactly once.
  fire(chatId) {
    const w = this.active(chatId)[0];
    if (!w) return null;
    w.state = "fired"; w.firedAt = new Date().toISOString();
    this.#save();
    return w;
  }
  cancel(id) {
    const w = this.items.find((x) => x.state === "active" && x.id.startsWith(id));
    if (!w) return null;
    w.state = "cancelled"; this.#save();
    return w;
  }
}
export function parseDuration(s) {
  const m = /^(\d+)\s*(m|min|h|hr|d)?$/i.exec(s ?? "");
  if (!m) return 0;
  const n = Number(m[1]), u = (m[2] ?? "m").toLowerCase();
  return u.startsWith("h") ? n * 60 : u === "d" ? n * 1440 : n;
}
