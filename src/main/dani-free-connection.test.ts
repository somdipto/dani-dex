import type { DaniDexModelSource } from "@dani-dex/contracts/online-services";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentModelSource, setRuntimeModelSource } from "../backend/model-source";
import { AgentInitializationGate } from "./agent-initialization";
import { DaniFreeConnection, type DaniFreeService } from "./dani-free-connection";

const source: DaniDexModelSource = {
  id: "dani",
  name: "Dani",
  baseUrl: "http://127.0.0.1:4444/v1",
  apiKey: "local-only",
  models: [{ id: "dani-free-auto", name: "Dani Free Auto" }],
};
const connections: DaniFreeConnection[] = [];
afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.stop()));
  setRuntimeModelSource(null);
});

/** The old client cannot confirm a new endpoint; only a successful discovery clears exclusion. */
function fixture(initialized: () => Promise<void> = async () => undefined) {
  let running = false;
  let excluded = false;
  let models: { id: string }[] = [];
  let reloadOutcome: "not-running" | "skipped-busy" | "restarted" = "not-running";
  const proxy = {
    start: vi.fn<() => Promise<DaniDexModelSource | null>>(async () => {
      running = true;
      return source;
    }),
    stop: vi.fn(async () => {
      running = false;
    }),
    isRunning: () => running,
  };
  const service: DaniFreeService = {
    saveCustomProvider: vi.fn(async (_id: string, persist: () => Promise<void>) => {
      excluded = true;
      return await persist();
    }),
    reloadOpenCodeConfig: vi.fn(async () => {
      if (reloadOutcome === "restarted") {
        models = [{ id: "dani/dani-free-auto" }];
        excluded = false;
      }
      return reloadOutcome;
    }),
    ensureProvider: vi.fn(async () => {
      models = [{ id: "dani/dani-free-auto" }];
      excluded = false;
    }),
    listModels: vi.fn(() => (excluded ? [] : models)),
  };
  const gate = new AgentInitializationGate(initialized);
  const connection = new DaniFreeConnection(proxy, service, gate, "/tmp/dani-free-connection-test", () => 10);
  connections.push(connection);
  return {
    connection,
    gate,
    proxy,
    service,
    setRunning: (value: boolean) => {
      running = value;
    },
    setReloadOutcome: (value: typeof reloadOutcome) => {
      reloadOutcome = value;
    },
    setModels: (value: { id: string }[]) => {
      models = value;
    },
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("Dani Free first-run connection", () => {
  it("waits for initialization and starts a clean keyless provider after the proxy is registered", async () => {
    let finish!: () => void;
    const initialized = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { connection, service, proxy } = fixture(() => initialized);
    connection.start();
    await settle();
    expect(proxy.start).toHaveBeenCalledOnce();
    expect(currentModelSource()).toEqual(source);
    expect(service.ensureProvider).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(service.ensureProvider).toHaveBeenCalledOnce());
    expect(service.listModels().map((model) => model.id)).toEqual(["dani/dani-free-auto"]);
    expect(service.saveCustomProvider).toHaveBeenCalledOnce();
  });

  it("retries a failed first spawn instead of leaving the free default unavailable", async () => {
    const { connection, proxy, service } = fixture();
    proxy.start.mockImplementationOnce(async () => null);
    connection.start();
    await vi.waitFor(() => expect(proxy.start).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(proxy.start).toHaveBeenCalledTimes(2));
    expect(service.listModels().map((model) => model.id)).toEqual(["dani/dani-free-auto"]);
  });

  it("retries a catalog that failed to list Dani even though the reload returned restarted", async () => {
    const { connection, service, setReloadOutcome } = fixture();
    setReloadOutcome("not-running");
    service.ensureProvider = vi.fn(async () => undefined);
    connection.start();
    await vi.waitFor(() => expect(service.reloadOpenCodeConfig).toHaveBeenCalled());
    expect(service.listModels()).toEqual([]);
    setReloadOutcome("restarted");
    await vi.waitFor(() => expect(service.listModels().map((model) => model.id)).toEqual(["dani/dani-free-auto"]));
    expect(service.saveCustomProvider).toHaveBeenCalledOnce();
  });

  it("recovers when initial backend initialization fails once", async () => {
    let attempts = 0;
    const { connection, service } = fixture(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary backend startup failure");
    });
    connection.start();
    await vi.waitFor(() => expect(attempts).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect(service.listModels().map((model) => model.id)).toContain("dani/dani-free-auto"));
    expect(service.saveCustomProvider).toHaveBeenCalledOnce();
  });

  it("keeps an endpoint excluded during a busy restart, then confirms it on retry", async () => {
    const { connection, service, setReloadOutcome } = fixture();
    setReloadOutcome("skipped-busy");
    connection.start();
    await vi.waitFor(() => expect(service.reloadOpenCodeConfig).toHaveBeenCalled());
    expect(service.listModels()).toEqual([]);
    setReloadOutcome("restarted");
    await vi.waitFor(() => expect(service.listModels().map((model) => model.id)).toEqual(["dani/dani-free-auto"]));
    expect(service.saveCustomProvider).toHaveBeenCalledOnce();
  });

  it("replaces a dead local proxy rather than reusing its old loopback URL", async () => {
    const { connection, service, proxy, setRunning, setModels } = fixture();
    connection.start();
    await vi.waitFor(() => expect(service.ensureProvider).toHaveBeenCalledOnce());
    setRunning(false);
    setModels([]);
    await vi.waitFor(() => expect(proxy.start).toHaveBeenCalledTimes(2));
    expect(service.saveCustomProvider).toHaveBeenCalledTimes(3);
    expect(service.listModels().map((model) => model.id)).toEqual(["dani/dani-free-auto"]);
  });
});

describe("Dani Free connection shutdown", () => {
  it("stops a proxy that reports ready after shutdown started", async () => {
    let ready!: (value: DaniDexModelSource) => void;
    const waiting = new Promise<DaniDexModelSource>((resolve) => {
      ready = resolve;
    });
    const { connection, proxy, service } = fixture();
    proxy.start.mockImplementationOnce(async () => waiting);
    connection.start();
    const stopping = connection.stop();
    ready(source);
    await stopping;
    expect(proxy.stop).toHaveBeenCalled();
    expect(service.saveCustomProvider).not.toHaveBeenCalled();
    expect(currentModelSource()).toBeNull();
  });
});
