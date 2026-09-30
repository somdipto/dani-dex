import { describe, expect, it, vi } from "vitest";
import type { ChatGptRegistration } from "../chatgpt-plan-store";

type Invoke = (event: { senderFrame: { url: string } }, payload: unknown) => unknown;
const bound = new Map<string, Invoke>();
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, listener: Invoke) => bound.set(channel, listener) },
}));
const { chatGptPlanIpcHandlers } = await import("./chatgpt-plan-handlers");
const record: ChatGptRegistration = {
  clientId: "issued",
  subject: "subject",
  email: "selected@example.com",
  accessToken: "private-access",
  refreshToken: "private-refresh",
  idToken: "private-id",
  scopes: ["chatgpt.tokens.use.direct"],
  expiresAt: 1900000000,
};
const summary = { clientId: record.clientId, email: record.email, planEnabled: true, expiresAt: record.expiresAt };
function fixture() {
  delete process.env.ELECTRON_RENDERER_URL;
  bound.clear();
  const service = {
    summaries: () => [summary],
    connect: vi.fn(async () => record),
    cancel: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  const group = chatGptPlanIpcHandlers({ service });
  for (const [name, bind] of Object.entries(group.chatGptPlan)) bind(name);
  return service;
}
const trusted = { senderFrame: { url: "dani-dex-app://app/index.html" } };
describe("ChatGPT IPC secret boundary", () => {
  it("returns only safe account summary, never tokens", async () => {
    fixture();
    const result = await bound.get("connect")?.(trusted, null);
    expect(result).toEqual(summary);
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it("rejects external senders before connect or storage", async () => {
    const service = fixture();
    expect(() => bound.get("connect")?.({ senderFrame: { url: "https://outside.invalid" } }, null)).toThrow();
    expect(service.connect).not.toHaveBeenCalled();
  });
  it("rejects invalid registration input before invoking the service", async () => {
    const service = fixture();
    expect(() => bound.get("disconnect")?.(trusted, { clientId: "issued" })).toThrow();
    expect(service.disconnect).not.toHaveBeenCalled();
  });
});
