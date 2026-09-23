import { describe, expect, it, vi } from "vitest";
import { decodeRealtimeSession, OpenAiRealtimeSessionService } from "./openai-realtime-session";

describe("OpenAI Realtime session service", () => {
  it("uses the signed-in Dani-Dex API to mint a short-lived browser credential", async () => {
    const requestAuthorized = vi.fn(async (_path, _init, decoder) =>
      decoder({
        client_secret: { value: "ek_live_1234567890", expires_at: 2_000 },
        session: { model: "gpt-realtime" },
      }),
    );
    const service = new OpenAiRealtimeSessionService({ requestAuthorized } as never);
    await expect(service.create()).resolves.toEqual({
      clientSecret: "ek_live_1234567890",
      expiresAt: 2_000,
      model: "gpt-realtime",
    });
    expect(requestAuthorized).toHaveBeenCalledWith(
      "/v1/realtime/client-secret",
      expect.objectContaining({ method: "POST" }),
      expect.any(Function),
      30_000,
    );
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
