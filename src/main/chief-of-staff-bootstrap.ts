import type { AgentStore } from "../backend/agent-store";

export const DEFAULT_CHIEF_ID = "chief-of-staff";

/** First-run local identity only. Does not start a provider or send a task. */
export async function prepareChiefOfStaff(store: AgentStore, setupCompleted: boolean): Promise<void> {
  if (setupCompleted || store.list().length > 0) return;
  await store.getOrCreate(DEFAULT_CHIEF_ID, "Chief of staff", "Coordinates your team");
}
