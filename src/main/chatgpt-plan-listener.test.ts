import { afterEach, describe, expect, it } from "vitest";
import { type ChatGptLoopback, startChatGptLoopback } from "./chatgpt-plan-listener";

const listeners: ChatGptLoopback[] = [];
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((l) => l.cancel()));
});
async function fixture() {
  const listener = await startChatGptLoopback({ hostId: "stable-host", appName: "Dani-Dex" });
  listeners.push(listener);
  const auth = new URL(listener.attempt.authorizationUrl);
  const callback = new URL(auth.searchParams.get("redirect_uri") ?? "");
  callback.search = new URLSearchParams({
    state: auth.searchParams.get("state") ?? "",
    code: "secret-code",
    client_id: "issued-client",
  }).toString();
  return { listener, callback };
}
describe("ChatGPT real loopback callback", () => {
  it("binds locally before browser launch and accepts one authenticated callback", async () => {
    const { listener, callback } = await fixture();
    const response = await fetch(callback);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("secret-code");
    expect(await listener.result).toMatchObject({ status: "code", clientId: "issued-client" });
    await expect(fetch(callback)).rejects.toThrow();
  });
  it("rejects wrong state and path without consuming a later valid callback", async () => {
    const { listener, callback } = await fixture();
    const wrong = new URL(callback);
    wrong.searchParams.set("state", "other");
    expect((await fetch(wrong)).status).toBe(400);
    const wrongPath = new URL(callback);
    wrongPath.pathname = "/wrong";
    expect((await fetch(wrongPath)).status).toBe(400);
    expect((await fetch(callback)).status).toBe(200);
    expect((await listener.result).status).toBe("code");
  });
  it("denial returns no token form and does not reflect external content", async () => {
    const { listener, callback } = await fixture();
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("error_description", "external-content");
    const response = await fetch(callback);
    expect(await response.text()).not.toContain("external-content");
    expect(await listener.result).toEqual({ status: "denied", error: "access_denied" });
  });
  it("cancel closes the port and rejects the pending result", async () => {
    const { listener, callback } = await fixture();
    await listener.cancel();
    await expect(listener.result).rejects.toThrow("ended");
    await expect(fetch(callback)).rejects.toThrow();
  });
});
