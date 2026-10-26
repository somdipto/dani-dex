import { appendFileSync, readFileSync, existsSync } from "node:fs";

// append-only memory: what the chief asks Dani to remember, injected into every run.
export class Memory {
  constructor(path) { this.path = path; }
  add(fact) { appendFileSync(this.path, JSON.stringify({ ts: new Date().toISOString(), fact }) + "\n"); }
  all() {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).fact);
  }
  prompt() {
    const facts = this.all();
    return facts.length ? `Things to remember about the chief:\n${facts.map((f) => `- ${f}`).join("\n")}\n\n` : "";
  }
}
