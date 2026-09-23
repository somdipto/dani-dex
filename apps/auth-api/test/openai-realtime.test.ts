import { describe, expect, it, vi } from "vitest";
import { createOpenAiRealtimeClientSecret, OpenAiRealtimeError } from "../src/server/openai-realtime";

describe("OpenAI Realtime client secrets", () => {
  it("mints a short-lived credential with the configured current model and a pseudonymous user id", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ client_secret: { value: "ephemeral" } }),
    );
    await expect(
      createOpenAiRealtimeClientSecret(
        { OPENAI_API_KEY: "server-secret", OPENAI_REALTIME_MODEL: "gpt-realtime" },
        "user-1",
        fetchMock,
      ),
    ).resolves.toEqual({ client_secret: { value: "ephemeral" } });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer server-secret");
    expect(new Headers(init?.headers).get("OpenAI-Safety-Identifier")).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(String(init?.body))).toEqual({ session: { type: "realtime", model: "gpt-realtime" } });
  });

  it("does not pretend email auth alone provides OpenAI authority", async () => {
    await expect(createOpenAiRealtimeClientSecret({}, "user-1")).rejects.toEqual(
      new OpenAiRealtimeError(503, "realtime_not_configured", "Realtime voice is not configured."),
    );
  });

  it("does not forward provider error bodies or the server key", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ error: { message: "key server-secret invalid" } }, { status: 401 }),
    );
    await expect(createOpenAiRealtimeClientSecret({ OPENAI_API_KEY: "server-secret" }, "user-1", fetchMock)).rejects.toMatchObject({
      status: 502, code: "realtime_session_failed", message: "OpenAI could not start a Realtime session.",
    });
  });
});
