import type { ImportLocalContextInput, ImportLocalContextResult } from "@dani-dex/contracts/context-import";
import { redactContextText } from "@dani-dex/logging";
import type { AgentService } from "../backend/agent-service";
import type { CentralAuthManager } from "./central-auth-manager";

/** No await between authority validation and local database writes: account changes cannot reroute a batch. */
export function importLocalContext(
  input: ImportLocalContextInput,
  service: Pick<AgentService, "createMemory" | "listMemories">,
  auth: Pick<CentralAuthManager, "getState">,
): ImportLocalContextResult {
  const state = auth.getState();
  if (state.status !== "signed_in" && state.status !== "signed_out") {
    throw new Error("Wait for the account to load before importing memories.");
  }
  const accountId = state.status === "signed_in" ? state.user.id : null;
  if (input.serverId !== "local" || accountId !== input.accountId) {
    throw new Error("The import belongs to another account or computer. Return to its original account to retry.");
  }
  const failedTexts: string[] = [];
  let saved = 0;
  for (const text of new Set(input.texts.map(redactContextText))) {
    try {
      // The memory store folds duplicates before its capacity check. Main serializes all windows' writes.
      const memory = service.createMemory({ agentId: input.agentId, text });
      if (!service.listMemories(input.agentId).some((item) => item.id === memory.id && item.text === memory.text)) {
        throw new Error("The imported memory could not be read back.");
      }
      saved += 1;
    } catch {
      failedTexts.push(text);
    }
  }
  return { saved, failedTexts };
}
