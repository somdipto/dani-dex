import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";

// Taste: what the chief wants more or less of. Proactive jobs read these
// weights; his replies move them. This is the feedback flywheel.
export class Taste {
  constructor(path) {
    this.path = path;
    this.data = { weights: {}, updatedAt: null };
    if (path && existsSync(path)) {
      try { this.data = { weights: {}, ...JSON.parse(readFileSync(path, "utf8")) }; } catch {}
    }
  }
  #save() {
    if (!this.path) return;
    this.data.updatedAt = new Date().toISOString();
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }
  adjust(topic, delta) {
    const key = topic.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
    if (!key) return null;
    const w = Math.round(((this.data.weights[key] ?? 1) + delta) * 100) / 100;
    this.data.weights[key] = Math.max(0, Math.min(3, w));
    this.#save();
    return { topic: key, weight: this.data.weights[key] };
  }
  set(topic, weight) {
    const key = topic.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
    if (!key) return null;
    this.data.weights[key] = Math.max(0, Math.min(3, weight));
    this.#save();
    return { topic: key, weight: this.data.weights[key] };
  }
  forPrompt() {
    const entries = Object.entries(this.data.weights);
    if (!entries.length) return "";
    return (
      "His taste weights (higher = wants more of it, 0 = never include): " +
      entries.map(([k, v]) => `${k} ${v}`).join(", ") +
      ". Prefer higher-weight topics and never include weight-0 topics."
    );
  }
}
