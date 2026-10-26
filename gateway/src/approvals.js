// Approval gate for anything sent as the owner. Approval binds the exact recipient and exact words; a change
// of either needs a new approval. Standing grants ("earned trust") are created only by an explicit owner action
// and cover one recipient + one kind, nothing near it.
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
const h = (s) => createHash("sha256").update(String(s)).digest("hex");
export class Approvals {
  constructor(path) {
    this.path = path; this.items = new Map(); this.grants = [];
    if (path && existsSync(path)) for (const l of readFileSync(path, "utf8").split("\n")) { if (!l.trim()) continue; const e = JSON.parse(l); if (e.grant) this.grants.push(e.grant); else this.items.set(e.id, e); }
  }
  #save(e) { if (this.path) appendFileSync(this.path, JSON.stringify(e) + "\n"); }
  request({ recipient, words, channel }) {
    if (!recipient || !words) throw new Error("recipient and words required");
    const e = { id: randomBytes(6).toString("hex"), recipient, channel: channel ?? "", wordsHash: h(words), state: "pending", at: new Date().toISOString() };
    this.items.set(e.id, e); this.#save(e); return e.id;
  }
  approve(id, by) { const e = this.items.get(id); if (!e || by !== "owner") return false; e.state = "approved"; this.#save(e); return true; }
  // owner only: standing permission for one recipient and one kind of message
  grant({ recipient, kind, by }) { if (by !== "owner" || !recipient || !kind) return false; const g = { recipient, kind }; this.grants.push(g); this.#save({ grant: g }); return true; }
  canSend({ id, recipient, words, kind }) {
    const e = id ? this.items.get(id) : null;
    if (e && e.state === "approved" && e.recipient === recipient && e.wordsHash === h(words)) return { ok: true, via: "approval" };
    if (kind && this.grants.some((g) => g.recipient === recipient && g.kind === kind)) return { ok: true, via: "grant" };
    return { ok: false, reason: e ? "recipient or words differ from what was approved, or not approved yet" : "no approval" };
  }
}
