// Heartbeat: the trigger half of "proactive agent = durable agent + trigger".
// Fires journaled jobs through the MCP task authority on a schedule, then
// pushes finished results to the paired chief on Telegram. Staying quiet is a
// first-class outcome: a job that answers NOTHING_NEW sends nothing.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Taste } from "./taste.js";

const IST_OFFSET_MIN = 330;
function istMinutes(now = new Date()) {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (utcMin + IST_OFFSET_MIN) % (24 * 60);
}
export function inQuietHours(now, quietStart, quietEnd) {
  if (quietStart == null || quietEnd == null) return false;
  const m = istMinutes(now);
  return quietStart <= quietEnd ? m >= quietStart && m < quietEnd : m >= quietStart || m < quietEnd;
}
export function dueAt(job, now = new Date()) {
  if (job.enabled === false) return null;
  if (inQuietHours(now, job.quietStart, job.quietEnd)) return null;
  const last = job.lastRunAt ? new Date(job.lastRunAt).getTime() : 0;
  if (job.intervalMin != null) return now.getTime() - last >= job.intervalMin * 60000 ? now : null;
  if (job.dailyAt) {
    const [h, m] = job.dailyAt.split(":").map(Number);
    const target = h * 60 + m;
    const nowM = istMinutes(now);
    const alreadyToday = job.lastRunAt && new Date(job.lastRunAt).getTime() > now.getTime() - 20 * 3600_000 && istMinutes(new Date(job.lastRunAt)) >= target;
    return nowM >= target && !alreadyToday ? now : null;
  }
  return null;
}

export class Heartbeat {
  constructor({ jobsPath, mcpUrl, mcpToken, telegramTokenFile, pairingPath, fetchImpl, tickMs = 30_000, log = console.log, tastePath }) {
    this.jobsPath = jobsPath;
    this.mcpUrl = mcpUrl?.replace(/\/$/, "");
    this.mcpToken = mcpToken;
    this.telegramTokenFile = telegramTokenFile;
    this.pairingPath = pairingPath;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.tickMs = tickMs;
    this.log = log;
    this.jobs = [];
    this.inFlight = new Map(); // jobId -> taskId
    this.timer = null;
    this.tastePath = tastePath ?? null;
  }
  load() {
    this.jobs = existsSync(this.jobsPath) ? JSON.parse(readFileSync(this.jobsPath, "utf8")) : [];
    return this.jobs;
  }
  save() {
    writeFileSync(this.jobsPath, JSON.stringify(this.jobs, null, 2) + "\n");
  }
  async #mcp(name, args) {
    const res = await this.fetch(this.mcpUrl + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.mcpToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    if (!res.ok) throw new Error(`mcp ${name}: ${res.status}`);
    const out = await res.json();
    return JSON.parse(out.result.content[0].text);
  }
  async #sendTelegram(text) {
    const pairing = JSON.parse(readFileSync(this.pairingPath, "utf8"));
    const chatId = pairing.chief?.conversationId;
    if (!chatId) { this.log("[heartbeat] no paired chief, not sending"); return false; }
    const token = readFileSync(this.telegramTokenFile, "utf8").trim();
    const res = await this.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
    });
    const out = await res.json();
    if (!out.ok) { this.log(`[heartbeat] telegram send failed: ${out.description}`); return false; }
    return true;
  }
  #promptFor(job) {
    const prior = (job.delivered ?? []).slice(-3).map((d, i) => `--- previously delivered ${i + 1} ---\n${d}`).join("\n");
    const taste = this.tastePath && existsSync(this.tastePath) ? new Taste(this.tastePath).forPrompt() : "";
    return "You are Dani, writing directly to your chief, Som. If you greet, say \"Hey Som\" - never address him as Dani.\n\n" + job.prompt + (taste ? `\n\n${taste}` : "") + (prior ? `\n\nDo not repeat stories already delivered:\n${prior}` : "") +
      `\n\nIf there is nothing worth sending right now, reply with exactly: NOTHING_NEW`;
  }
  async tick(now = new Date()) {
    for (const job of this.jobs) {
      if (this.inFlight.has(job.id)) { await this.#collect(job); continue; }
      if (!dueAt(job, now)) continue;
      job.lastRunAt = now.toISOString();
      this.save();
      try {
        const { id } = await this.#mcp("delegate_task", { task: this.#promptFor(job) });
        this.inFlight.set(job.id, id);
        job.lastTaskId = id;
        this.log(`[heartbeat] fired job ${job.id} as task ${id}`);
      } catch (err) {
        this.log(`[heartbeat] job ${job.id} failed to fire: ${err.message}`);
      }
      this.save();
    }
    for (const job of this.jobs) if (this.inFlight.has(job.id)) await this.#collect(job);
  }
  async #collect(job) {
    const taskId = this.inFlight.get(job.id);
    let r;
    try { r = await this.#mcp("task_result", { id: taskId }); } catch { return; }
    if (r.state !== "done" && r.state !== "failed") return;
    this.inFlight.delete(job.id);
    if (r.state === "failed") { this.log(`[heartbeat] job ${job.id} task failed: ${r.error}`); this.save(); return; }
    const answer = (r.answer ?? "").trim();
    if (!answer || answer.startsWith("NOTHING_NEW")) { this.log(`[heartbeat] job ${job.id}: nothing new`); this.save(); return; }
    const sent = await this.#sendTelegram(answer);
    if (sent) {
      job.delivered = [...(job.delivered ?? []), answer.slice(0, 1500)].slice(-10);
      job.lastDeliveredAt = new Date().toISOString();
      this.log(`[heartbeat] job ${job.id} delivered (${answer.length} chars)`);
    }
    this.save();
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((e) => this.log(`[heartbeat] tick error: ${e.message}`)), this.tickMs);
    this.tick().catch((e) => this.log(`[heartbeat] tick error: ${e.message}`));
    this.log(`[heartbeat] started, ${this.jobs.length} job(s), tick ${this.tickMs / 1000}s`);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

// Standalone service entry (node src/heartbeat.js --serve)
if (process.argv.includes("--serve")) {
  const hb = new Heartbeat({
    jobsPath: process.env.DANI_JOBS ?? "./jobs.json",
    mcpUrl: process.env.DANI_MCP_URL ?? "http://127.0.0.1:8788",
    mcpToken: readFileSync(process.env.DANI_MCP_TOKEN_FILE, "utf8").trim(),
    telegramTokenFile: process.env.TELEGRAM_BOT_TOKEN_FILE,
    pairingPath: process.env.DANI_PAIRING ?? "./pairing.json",
    tastePath: process.env.DANI_TASTE ?? "./taste.json",
  });
  hb.load();
  hb.start();
}
