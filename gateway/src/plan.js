import { readFileSync, existsSync } from "node:fs";

// Plan gate: which paid capabilities this install has. Never hardcode
// plan checks - read this. Free plan: voice is optional ("cartesia" with
// limited monthly credits, or "local" for the on-device model, or "off").
// Phone calling is on for everyone right now but must stay behind this
// flag so it can move to paid later.
export const DEFAULT_PLAN = {
  name: "free",
  voice: "off",          // "off" | "cartesia" | "local"
  cartesiaMonthlyCreditCents: 500,
  phoneEnabled: true,    // free for now; flip to false to gate to paid
};

export function loadPlan(path) {
  if (path && existsSync(path)) {
    try { return { ...DEFAULT_PLAN, ...JSON.parse(readFileSync(path, "utf8")) }; } catch {}
  }
  return { ...DEFAULT_PLAN };
}
export const canUseCartesiaVoice = (p) => p.voice === "cartesia";
export const canUseLocalVoice = (p) => p.voice === "local";
export const canUsePhone = (p) => p.phoneEnabled === true;
