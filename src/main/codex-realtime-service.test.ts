import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexRealtimeService } from "./codex-realtime-service";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const home = await mkdtemp(join(tmpdir(), "dani-realtime-")); roots.push(home);
  const calls: { method: string; params: unknown }[] = [];
  const client = Object.assign(new EventEmitter(), {
    provider: "codex" as const, running: true, start: vi.fn(), stop: vi.fn(async () => undefined),
    notify: vi.fn(), respond: vi.fn(), respondError: vi.fn(),
    request: async <T>(method: string, params: unknown, decode: (value: unknown) => T) => {
      calls.push({ method, params });
      if (method === "account/read") return decode({ account: { type: "chatgpt" } });
      if (method === "account/login/start") return decode({ authUrl: "https://auth.openai.com/oauth/authorize" });
      if (method === "thread/start") return decode({ thread: { id: "voice-thread" } });
      if (method === "thread/realtime/start") queueMicrotask(() => client.emit("notification", { method: "thread/realtime/sdp", params: { threadId: "voice-thread", sdp: "v=0\r\nanswer" } }));
      return decode({});
    },
  });
  const open = vi.fn(async () => undefined);
  return { service: new CodexRealtimeService(home, () => "codex", open, () => client), calls, client, open };
}
describe("experimental official Codex voice", () => {
  it("requires explicit consent before spawning or requesting a session", async () => {
    const { service, calls } = await setup();
    await expect(service.start("v=0\r\noffer", false)).rejects.toThrow("consent");
    expect(calls).toHaveLength(0);
  });
  it("negotiates with WebRTC, not API-key audio, and cleans the listener and session", async () => {
    const { service, calls, client } = await setup();
    await expect(service.start("v=0\r\noffer", true)).resolves.toEqual({ sdp: "v=0\r\nanswer" });
    expect(calls.find((x) => x.method === "thread/realtime/start")?.params).toEqual({ threadId: "voice-thread", transport: { type: "webrtc", sdp: "v=0\r\noffer" } });
    expect(client.listenerCount("notification")).toBe(0);
    await service.stop();
    expect(calls.at(-1)?.method).toBe("thread/realtime/stop");
    await service.dispose();
  });
  it("uses the official own-auth login without starting inference", async () => {
    const { service, calls, open } = await setup();
    await service.connect();
    expect(open).toHaveBeenCalledWith("https://auth.openai.com/oauth/authorize");
    expect(calls.some((x) => x.method === "thread/start")).toBe(false);
    await service.dispose();
  });
  it("stop during preparation prevents thread and realtime requests", async () => {
    const { service, calls, client } = await setup();
    const request = client.request;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    client.request = async (method, params, decode) => {
      if (method === "initialize") await held;
      return request(method, params, decode);
    };
    const starting = service.start("v=0\r\noffer", true);
    const rejected = expect(starting).rejects.toThrow("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.stop(); release?.(); await rejected;
    expect(calls.some((x) => x.method === "thread/start" || x.method === "thread/realtime/start")).toBe(false);
    await service.dispose();
  });
  it("dispose during preparation stops the prepared client and denies future status", async () => {
    const { service, client } = await setup();
    const request = client.request;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    client.request = async (method, params, decode) => {
      if (method === "initialize") await held;
      return request(method, params, decode);
    };
    const pending = service.status();
    const rejected = expect(pending).rejects.toThrow("closed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const disposing = service.dispose(); release?.();
    await rejected; await disposing;
    expect(client.stop).toHaveBeenCalled();
    await expect(service.status()).rejects.toThrow("closed");
  });

});
