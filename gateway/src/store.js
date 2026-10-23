import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

// Durable task journal: one JSONL line per event, replayed on boot.
export class TaskStore {
  constructor(path) {
    this.path = path;
    this.tasks = new Map();
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const e = JSON.parse(line);
        const t = this.tasks.get(e.id) ?? { id: e.id, events: [] };
        Object.assign(t, e.patch ?? {});
        if (e.message) t.events.push({ ts: e.ts, message: e.message });
        this.tasks.set(e.id, t);
      }
    }
  }
  #write(id, patch, message) {
    appendFileSync(this.path, JSON.stringify({ ts: new Date().toISOString(), id, patch, message }) + "\n");
  }
  create(kind, input) {
    const id = randomBytes(8).toString("hex");
    const t = { id, kind, state: "queued", input, events: [] };
    this.tasks.set(id, t);
    this.#write(id, { kind, state: "queued", input }, `created ${kind}`);
    return id;
  }
  get(id) { return this.tasks.get(id) ?? null; }
  findByPrefix(prefix) {
    if (!prefix) return null;
    const hits = [...this.tasks.values()].filter((t) => t.id.startsWith(prefix));
    return hits.length === 1 ? hits[0] : null;
  }
  update(id, patch, message) {
    const t = this.tasks.get(id);
    if (!t) return;
    Object.assign(t, patch);
    if (message) t.events.push({ ts: new Date().toISOString(), message });
    this.#write(id, patch, message);
  }
  log(id, message) { this.update(id, {}, message); }
}
