import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Cartesia } from "./cartesia.js";

const key = readFileSync(process.env.CARTESIA_KEY_FILE, "utf8").trim();
const statePath = join(dirname(process.env.CARTESIA_KEY_FILE), "..", "state", "cartesia.json");
const c = new Cartesia({ apiKey: key });

const AGENT = {
  name: "dani",
  instructions: "You are Dani, Som's personal agent and close collaborator. You run his life factory: research, tasks, reminders, web checks, bookings, and day-to-day questions. Talk like a sharp, warm friend on a phone call - short sentences, no lists, no markdown, no filler. Never mention being an AI model, never name underlying models or providers. If something needs doing on his computer or accounts, say you'll take care of it and follow up on Telegram. Keep answers under 3 sentences unless he asks for detail.",
  initialMessage: "Hey, it's Dani. What's up?",
  voiceId: "30894953-bcce-41fe-892c-15ce19c843ff", // Parker
  model: process.env.CARTESIA_AGENT_MODEL || undefined,
};

const agentId = await c.ensureAgent(AGENT);
const numbers = await c.listPhoneNumbers();
const num = numbers.find((n) => n.label === "dani") ?? numbers[0];
if (!num) throw new Error("no phone number on this Cartesia account");
if ((num.agent?.id ?? num.agent) !== agentId) await c.assignNumber(num.id, agentId);
mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(statePath, JSON.stringify({ agentId, phoneNumberId: num.id, number: num.number, provisionedAt: new Date().toISOString() }, null, 2));
console.log(`agent ${agentId} live on ${num.number}`);
