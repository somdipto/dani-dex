import { describe, expect, it, vi } from "vitest";
import { decodeRealtimeSession, OpenAiRealtimeSessionService } from "./openai-realtime-session";

describe("OpenAI Realtime session service", () => {
  it("mints a short-lived browser credential from the user's own OpenAI key", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      Response.json({
        value: "ek_live_1234567890",
        expires_at: 2_000,
        session: { type: "realtime", model: "gpt-realtime" },
      }),
    );
    const credentials = { get: vi.fn((id: string) => (id === "openai-realtime" ? " sk-user-key " : null)) };
    const service = new OpenAiRealtimeSessionService(credentials, fetchImpl);
    await expect(service.create()).resolves.toEqual({
      clientSecret: "ek_live_1234567890",
      expiresAt: 2_000,
      model: "gpt-realtime",
    });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-user-key");
    expect(JSON.parse(String(init?.body))).toEqual({ session: { type: "realtime", model: "gpt-realtime" } });
  });

  it("asks for a key before calling OpenAI, and never echoes a key back in an error", async () => {
    const fetchImpl = vi.fn();
    await expect(new OpenAiRealtimeSessionService({ get: () => null }, fetchImpl).create()).rejects.toThrow(
      "Add your OpenAI API key in Settings > Voice",
    );
    expect(fetchImpl).not.toHaveBeenCalled();

    const rejected = new OpenAiRealtimeSessionService({ get: () => "sk-bad" }, async () =>
      Response.json({ error: { message: "Incorrect API key" } }, { status: 401 }),
    );
    await expect(rejected.create()).rejects.toThrow("OpenAI rejected the API key");

    const quota = new OpenAiRealtimeSessionService({ get: () => "sk-user-key" }, async () =>
      Response.json({ error: { message: "Quota exceeded for sk-abcdefghijkl1234." } }, { status: 429 }),
    );
    const error = await quota.create().catch((caught: unknown) => caught);
    expect(String(error)).toContain("HTTP 429");
    expect(String(error)).toContain("Quota exceeded");
    expect(String(error)).not.toContain("abcdefghijkl1234");
  });

  it("accepts a normalized server response and fails closed on missing credentials", () => {
    expect(
      decodeRealtimeSession({
        value: "ek_live_1234567890",
        expires_at: 3_000,
        session: { type: "realtime", model: "gpt-realtime" },
      }),
    ).toEqual({ clientSecret: "ek_live_1234567890", expiresAt: 3_000, model: "gpt-realtime" });
    expect(
      decodeRealtimeSession({ clientSecret: "ek_live_1234567890", expiresAt: 2_000, model: "gpt-realtime" }),
    ).toEqual({ clientSecret: "ek_live_1234567890", expiresAt: 2_000, model: "gpt-realtime" });
    expect(() => decodeRealtimeSession({ expiresAt: 2_000, model: "gpt-realtime" })).toThrow(
      "invalid Realtime session",
    );
  });
});
