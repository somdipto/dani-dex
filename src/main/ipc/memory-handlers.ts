// An agent's long-lived memories: the notes it carries between threads.

import { parseImportLocalContext } from "@dani-dex/contracts/context-import";
import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import { TEAM_API_ROUTES } from "@dani-dex/contracts/team-api-routes";
import type { AgentService } from "../../backend/agent-service";
import type { CentralAuthManager } from "../central-auth-manager";
import { importLocalContext } from "../context-import-service";
import { decodeAgentMemories, decodeAgentMemory } from "../remote-agent-decoding";
import { decodeVoid } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import {
  parseAgentRequest,
  parseCreateAgentMemory,
  parseDeleteAgentMemory,
  parseUpdateAgentMemory,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { routeToServer } from "./route-to-server";
import { requireString } from "./validation";

interface MemoryIpcDependencies {
  service: AgentService;
  remoteServers: RemoteServerManager;
  centralAuth: Pick<CentralAuthManager, "getState">;
}

export function memoryIpcHandlers({
  service,
  remoteServers,
  centralAuth,
}: MemoryIpcDependencies): Pick<IpcGroupHandlers, "agentMemories"> {
  return {
    agentMemories: {
      importLocalContext: payloadHandler(parseImportLocalContext, (input) =>
        importLocalContext(input, service, centralAuth),
      ),
      listMemories: payloadHandler(parseAgentRequest, (scoped) => {
        const agentId = requireString(scoped.payload, "agentId", INPUT_LIMITS.identifier);
        return routeToServer(scoped.serverId, {
          local: () => service.listMemories(agentId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(agentId), decodeAgentMemories),
        });
      }),
      createMemory: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseCreateAgentMemory(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.createMemory(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(parsed.agentId), decodeAgentMemory, {
              method: "POST",
              body: { text: parsed.text },
            }),
        });
      }),
      updateMemory: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseUpdateAgentMemory(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.updateMemory(parsed),
          remote: (serverId) =>
            remoteServers.request(
              serverId,
              TEAM_API_ROUTES.agent.memory(parsed.agentId, parsed.memoryId),
              decodeAgentMemory,
              {
                method: "PATCH",
                body: { text: parsed.text },
              },
            ),
        });
      }),
      deleteMemory: payloadHandler(parseAgentRequest, (scoped) => {
        const parsed = parseDeleteAgentMemory(scoped.payload);
        return routeToServer(scoped.serverId, {
          local: () => service.deleteMemory(parsed),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memory(parsed.agentId, parsed.memoryId), decodeVoid, {
              method: "DELETE",
            }),
        });
      }),
      clearMemories: payloadHandler(parseAgentRequest, (scoped) => {
        const agentId = requireString(scoped.payload, "agentId", INPUT_LIMITS.identifier);
        return routeToServer(scoped.serverId, {
          local: () => service.clearMemories(agentId),
          remote: (serverId) =>
            remoteServers.request(serverId, TEAM_API_ROUTES.agent.memories(agentId), decodeVoid, { method: "DELETE" }),
        });
      }),
    },
  };
}
