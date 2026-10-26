import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";

// Durable chief inbox: every inbound message is persisted BEFORE it is
// handled, so a crash mid-handling never loses what he said. Items are
// processed in order; unprocessed items are drained on boot and whenever
// a running task finishes.
export class Inbox {
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
    writeFileSync(tmp, JSON.stringify({ items: this.items.slice(-200) }));
    renameSync(tmp, this.path);
  }
  add(updateId, chatId, text) {
    if (this.items.some((i) => i.updateId === updateId)) return null;
    const item = { updateId, chatId, text, at: new Date().toISOString(), status: "pending", acked: false };
    this.items.push(item);
    this.#save();
    return item;
  }
  pending() { return this.items.filter((i) => i.status === "pending"); }
  markDone(item) { item.status = "done"; this.#save(); }
  markAcked(item) { item.acked = true; this.#save(); }
}
