// A bot's evolving operating instructions: read, edit, pause, and rewrite now.

import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import type { UpdateAgentOperatingInstructionsInput } from "@dani-dex/contracts/ipc";
import { isBoolean, isString } from "@dani-dex/contracts/runtime-values";
import type { AgentService } from "../../backend/agent-service";
import { parseAgentRequest } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { isObject, requireString } from "./validation";

// The team API has no route for them yet, so a bot on another computer answers this plainly
// instead of the panel showing an empty set that looks like the bot has none.
const REMOTE_UNAVAILABLE = "Operating instructions are only available for bots on this computer.";

export function parseUpdateOperatingInstructions(value: unknown): UpdateAgentOperatingInstructionsInput {
  if (!isObject(value)) throw new Error("Invalid operating instructions request.");
  const agentId = requireString(value.agentId, "agentId", INPUT_LIMITS.identifier);
  if (value.text !== undefined && !isString(value.text)) throw new Error("text must be a string.");
  if (isString(value.text) && value.text.length > INPUT_LIMITS.agentOperatingInstructions) {
    throw new Error("The instructions are too long.");
  }
  if (value.autoEvolve !== undefined && !isBoolean(value.autoEvolve)) throw new Error("autoEvolve must be a boolean.");
  return {
    agentId,
    ...(isString(value.text) ? { text: value.text } : {}),
    ...(isBoolean(value.autoEvolve) ? { autoEvolve: value.autoEvolve } : {}),
  };
}

export function operatingInstructionsIpcHandlers({
  service,
}: {
  service: AgentService;
}): Pick<IpcGroupHandlers, "agentOperatingInstructions"> {
  const remote = (): never => {
    throw new Error(REMOTE_UNAVAILABLE);
  };
  return {
    agentOperatingInstructions: {
      getOperatingInstructions: payloadHandler(parseAgentRequest, (scoped) => {
        const agentId = requireString(scoped.payload, "agentId", INPUT_LIMITS.identifier);
        return routeToServer(scoped.serverId, { local: () => service.getOperatingInstructions(agentId), remote });
      }),
      updateOperatingInstructions: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseUpdateOperatingInstructions(scoped.payload);
        return routeToServer(scoped.serverId, { local: () => service.updateOperatingInstructions(parsed), remote });
      }),
      refreshOperatingInstructions: payloadHandler(parseAgentRequest, (scoped) => {
        const agentId = requireString(scoped.payload, "agentId", INPUT_LIMITS.identifier);
        return routeToServer(scoped.serverId, { local: () => service.refreshOperatingInstructions(agentId), remote });
      }),
    },
  };
}
