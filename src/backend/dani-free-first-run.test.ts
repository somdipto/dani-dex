import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DaniDexModelSource } from "@dani-dex/contracts/online-services";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentInitializationGate } from "../main/agent-initialization";
import { DaniFreeConnection } from "../main/dani-free-connection";
import type { AgentService } from "./agent-service";
import { createFakeOpencode, createTestService, FakeAgentClient, stores } from "./agent-service-test-harness";
import { currentModelSource, setRuntimeModelSource } from "./model-source";

const source: DaniDexModelSource = {
  id: "dani",
  name: "Dani",
  baseUrl: "http://127.0.0.1:40000/v1",
  apiKey: "local-only",
  models: [{ id: "dani-free-auto", name: "Dani Free Auto" }],
};
const priorPath = process.env.DANI_DEX_OPENCODE_PATH;
let root: string;
let service: AgentService | null = null;
let connection: DaniFreeConnection | null = null;
afterEach(async () => {
  await connection?.stop();
  await service?.stop();
  setRuntimeModelSource(null);
  if (priorPath === undefined) delete process.env.DANI_DEX_OPENCODE_PATH;
  else process.env.DANI_DEX_OPENCODE_PATH = priorPath;
  if (root) await rm(root, { recursive: true, force: true });
  service = null;
  connection = null;
});

describe("Dani Free first-run service path", () => {
  it("registers the keyless proxy after backend startup and lists Dani Free without Connect", async () => {
    root = await mkdtemp(join(tmpdir(), "dani-first-run-"));
    process.env.DANI_DEX_OPENCODE_PATH = await createFakeOpencode(root);
    const { store, mailbox } = stores(root);
    const clients: FakeAgentClient[] = [];
    const agentService = createTestService({
      store,
      mailbox,
      preferredProvider: "opencode",
      clientFactory: (provider) => {
        const client = new FakeAgentClient(provider);
        if (provider === "opencode") {
          const sourceAtSpawn = currentModelSource();
          client.modelList = () => ({
            data: sourceAtSpawn ? [{ model: "dani/dani-free-auto", displayName: "Dani/Dani Free Auto" }] : [],
          });
          clients.push(client);
        }
        return client;
      },
    });
    let proxyReady!: (value: DaniDexModelSource) => void;
    const proxyWaiting = new Promise<DaniDexModelSource>((resolve) => {
      proxyReady = resolve;
    });
    const proxy = {
      start: vi.fn(async () => proxyWaiting),
      stop: vi.fn(async () => undefined),
      isRunning: () => true,
    };
    service = agentService;
    const gate = new AgentInitializationGate(() => agentService.initialize());
    connection = new DaniFreeConnection(proxy, agentService, gate, join(root, "dani-free"));
    // The proxy registers while the first initialization may have already started.
    const initial = gate.start();
    connection.start();
    await initial;
    // The first OpenCode process was born before the proxy; it has no Dani catalog.
    expect(agentService.listModels().some((model) => model.id === "dani/dani-free-auto")).toBe(false);
    expect(clients).toHaveLength(1);
    proxyReady(source);
    await vi.waitFor(() => expect(agentService.listModels().map((model) => model.id)).toContain("dani/dani-free-auto"));
    expect(agentService.listModels().filter((model) => model.id.startsWith("dani/"))).toHaveLength(1);
    expect(currentModelSource()).toEqual(source);
    expect(clients.length).toBeGreaterThan(1);
    expect(clients.some((client) => client.requests.some((request) => request.method === "account/login/start"))).toBe(
      false,
    );
  });
});
