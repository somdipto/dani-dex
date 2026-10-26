import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";

const TTL_MS = 10 * 60 * 1000;
const hash = (code) => createHash("sha256").update(`dani-pair:${code}`).digest("hex");

export class PairingStore {
  constructor(path) {
    this.path = path;
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  }
  #save() {
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }
  chief() { return this.data.chief ?? null; }
  issueCode() {
    const code = String(randomInt(0, 1000000)).padStart(6, "0");
    this.data.code = { hash: hash(code), expiresAt: Date.now() + TTL_MS, attempts: 0, used: false };
    this.#save();
    return { code, expiresAt: this.data.code.expiresAt };
  }
  tryPair(code, senderId, conversationId) {
    const c = this.data.code;
    if (!c || c.used) return { ok: false, reason: "no-code" };
    if (Date.now() > c.expiresAt) return { ok: false, reason: "expired" };
    if (c.attempts >= 5) return { ok: false, reason: "locked" };
    const a = Buffer.from(hash(code.trim()));
    const b = Buffer.from(c.hash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      c.attempts += 1;
      this.#save();
      return { ok: false, reason: "wrong" };
    }
    c.used = true;
    this.data.chief = { senderId, conversationId, pairedAt: new Date().toISOString() };
    this.#save();
    return { ok: true };
  }
  unpair() { delete this.data.chief; this.#save(); }
}
