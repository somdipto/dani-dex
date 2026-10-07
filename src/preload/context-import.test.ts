import { parseImportLocalContext } from "@dani-dex/contracts/context-import";
import { type DaniDexDesktopApi, IPC_CHANNELS } from "@dani-dex/contracts/ipc";
import { expect, it, vi } from "vitest";
import { parseAgentRequest } from "../main/ipc/agent-inputs";

const bridge = vi.hoisted(() => {
  vi.stubGlobal("window", { addEventListener: () => {} });
  const api: { current: DaniDexDesktopApi | null } = { current: null };
  return { api, invoke: vi.fn() };
});
vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: DaniDexDesktopApi) => {
      bridge.api.current = api;
    },
  },
  webUtils: {},
  ipcRenderer: { invoke: bridge.invoke, on: () => {} },
}));

import "./index";

it("keeps local imports and explicit memory readback on their owner when a remote server is selected", async () => {
  const api = bridge.api.current;
  if (!api) throw new Error("The preload API was not exposed.");
  bridge.invoke.mockImplementation(async (channel: string, request: unknown) => {
    if (channel === IPC_CHANNELS.serversSelect) return [{ id: "remote-chief", active: true }];
    if (channel === IPC_CHANNELS.agentImportLocalContext) {
      expect(parseImportLocalContext(request)).toEqual({
        accountId: null,
        serverId: "local",
        agentId: "chief",
        texts: ["Private context"],
      });
      return { saved: 1, failedTexts: [] };
    }
    if (channel === IPC_CHANNELS.agentListMemories) {
      expect(parseAgentRequest(request).serverId).toBe("local");
      return [];
    }
    throw new Error("Unexpected IPC channel.");
  });
  await api.servers.select("remote-chief");
  await expect(
    api.agent.importLocalContext({ accountId: null, serverId: "local", agentId: "chief", texts: ["Private context"] }),
  ).resolves.toEqual({ saved: 1, failedTexts: [] });
  await api.agent.listMemories("chief", "local");
});

it("rejects ambiguous import responses so staged entries cannot be cleared as successful", async () => {
  const api = bridge.api.current;
  if (!api) throw new Error("The preload API was not exposed.");
  bridge.invoke.mockResolvedValueOnce({ saved: 1 });
  await expect(
    api.agent.importLocalContext({ accountId: null, serverId: "local", agentId: "chief", texts: ["Private context"] }),
  ).rejects.toThrow();
});
