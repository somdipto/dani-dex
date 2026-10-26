import { readFileSync, existsSync } from "node:fs";
import { Cartesia } from "./cartesia.js";
import { loadPlan, canUseCartesiaVoice } from "./plan.js";

// POST /voice/session: hand a paired client a 5-minute scoped voice token.
// The long-lived Cartesia key never leaves the host; the client then opens
// the full-duplex socket itself (see src/voice.js for the wire protocol).
export async function voiceSession({ planPath, keyFile, statePath, cartesia }) {
  const plan = loadPlan(planPath);
  if (!canUseCartesiaVoice(plan)) return { code: 403, body: { error: "voice is not enabled on this plan", plan: plan.name } };
  if (!statePath || !existsSync(statePath)) return { code: 503, body: { error: "voice agent is not provisioned" } };
  const { agentId } = JSON.parse(readFileSync(statePath, "utf8"));
  const c = cartesia ?? new Cartesia({ apiKey: readFileSync(keyFile, "utf8").trim() });
  const token = await c.accessToken(agentId);
  return { code: 200, body: { agentId, token, expiresIn: 300, protocol: "cartesia-agents-websocket" } };
}
