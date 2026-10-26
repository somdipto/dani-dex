import { readFileSync } from "node:fs";
import { TelegramChief } from "./telegram.js";
import { TaskStore } from "./store.js";
import { PairingStore } from "./pairing-store.js";
import { Memory } from "./memory.js";
import { OpenCodeExecutor } from "./executor-opencode.js";
import { Taste } from "./taste.js";
import { Inbox } from "./inbox.js";
import { Watches } from "./watch.js";

const token = readFileSync(process.env.TELEGRAM_BOT_TOKEN_FILE, "utf8").trim();
const store = new TaskStore(process.env.DANI_JOURNAL ?? "./tasks.jsonl");
const pairing = new PairingStore(process.env.DANI_PAIRING ?? "./pairing.json");
const memory = new Memory(process.env.DANI_MEMORY ?? "./memory.jsonl");
const executor = new OpenCodeExecutor({ baseUrl: process.env.DANI_OPENCODE_BASE_URL, memory });
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

const taste = new Taste(process.env.DANI_TASTE ?? "./taste.json");
const chief = new TelegramChief({
  token, store, pairing, memory, executor,
  statePath: process.env.DANI_TELEGRAM_STATE ?? "./telegram-state.json",
  logger: log,
  taste,
  watches: new Watches(process.env.DANI_WATCHES ?? "./watches.json"),
  inbox: new Inbox(process.env.DANI_INBOX ?? "./inbox.json"),
  pendingPath: process.env.DANI_PENDING ?? "./pending-question.json",
});
await chief.drainInbox(); // anything he said while we were down comes first
log("dani telegram chief gateway polling (pairing mode)");
for (;;) {
  try {
    await chief.pollOnce();
  } catch (e) {
    log(`poll error: ${e.message}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
