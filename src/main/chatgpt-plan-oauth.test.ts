import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ChatGptAuthorizationAttempt, hasChatGptPlanScope } from "./chatgpt-plan-oauth";

const options = {
  redirectUri: "http://127.0.0.1:54321/auth/callback",
  hostId: "urn:uuid:stable-host",
  appName: "Dani-Dex",
};
function callback(attempt: ChatGptAuthorizationAttempt, values: Record<string, string> = {}): string {
  const url = new URL(options.redirectUri);
  const auth = new URL(attempt.authorizationUrl);
  url.search = new URLSearchParams({
    state: auth.searchParams.get("state") ?? "",
    code: "one-time-code",
    client_id: "issued-client",
    ...values,
  }).toString();
  return url.href;
}

describe("ChatGPT public-client authorization foundation", () => {
  it("uses fresh state, nonce and S256 PKCE with dynamic initial registration", () => {
    const a = new ChatGptAuthorizationAttempt(options);
    const b = new ChatGptAuthorizationAttempt(options);
    const auth = new URL(a.authorizationUrl);
    expect(auth.origin + auth.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(auth.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(auth.searchParams.get("resource")).toBe("https://api.openai.com/v1");
    expect(auth.searchParams.get("state")).not.toBe(new URL(b.authorizationUrl).searchParams.get("state"));
    expect(a.nonce).not.toBe(b.nonce);
    const result = a.consumeCallback(callback(a));
    if (result.status !== "code") throw new Error("Expected a code.");
    const verifier = result.tokenForm.get("code_verifier") ?? "";
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(auth.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(result.tokenForm.get("redirect_uri")).toBe(options.redirectUri);
    expect(result.tokenForm.has("client_secret")).toBe(false);
    expect(() => a.consumeCallback(callback(a))).toThrow("ended");
  });
  it.each([
    "https://127.0.0.1:54321/auth/callback",
    "http://localhost:54321/auth/callback",
    "http://127.0.0.1/auth/callback",
    "http://127.0.0.1:54321/callback",
    "http://127.0.0.1:54321/auth/callback?q=1",
    "http://user@127.0.0.1:54321/auth/callback",
  ])("rejects unsafe redirect %s", (redirectUri) => {
    expect(() => new ChatGptAuthorizationAttempt({ ...options, redirectUri })).toThrow();
  });
  it("rejects wrong state and callback path without consuming the legitimate callback", () => {
    const a = new ChatGptAuthorizationAttempt(options);
    expect(() => a.consumeCallback(callback(a, { state: "wrong" }))).toThrow("state");
    expect(() => a.consumeCallback(callback(a).replace("/auth/callback", "/other"))).toThrow("Unexpected");
    expect(() => a.consumeCallback(`${callback(a)}&state=duplicate`)).toThrow("Duplicate");
    expect(a.consumeCallback(callback(a)).status).toBe("code");
  });
  it("validates state before handling denial and never exchanges a denied code", () => {
    const a = new ChatGptAuthorizationAttempt(options);
    expect(() => a.consumeCallback(callback(a, { state: "wrong", error: "access_denied" }))).toThrow("state");
    expect(a.consumeCallback(callback(a, { error: "access_denied" }))).toEqual({
      status: "denied",
      error: "access_denied",
    });
    expect(() => a.consumeCallback(callback(a))).toThrow("ended");
  });
  it("rejects missing or placeholder issued IDs in a new registration", () => {
    for (const id of ["", "dynamic_agent_client"]) {
      const a = new ChatGptAuthorizationAttempt(options);
      expect(() => a.consumeCallback(callback(a, { client_id: id }))).toThrow();
    }
  });
  it("retains a selected registration and rejects replacement", () => {
    const a = new ChatGptAuthorizationAttempt({ ...options, clientId: "saved-client" });
    const url = new URL(callback(a));
    url.searchParams.delete("client_id");
    expect(a.consumeCallback(url.href)).toMatchObject({ status: "code", clientId: "saved-client" });
    const b = new ChatGptAuthorizationAttempt({ ...options, clientId: "saved-client" });
    expect(() => b.consumeCallback(callback(b))).toThrow("client mismatch");
  });
  it("omits the initial app hint and carries only selected-account hints on reauthorization", () => {
    const a = new ChatGptAuthorizationAttempt({
      ...options,
      clientId: "saved-client",
      idTokenHint: "saved-id-token",
      loginHint: "selected@example.com",
    });
    const auth = new URL(a.authorizationUrl);
    expect(auth.searchParams.has("agent_name_hint")).toBe(false);
    expect(auth.searchParams.get("id_token_hint")).toBe("saved-id-token");
    expect(auth.searchParams.get("login_hint")).toBe("selected@example.com");
  });
  it("cancel prevents later acceptance", () => {
    const a = new ChatGptAuthorizationAttempt(options);
    a.cancel();
    expect(() => a.consumeCallback(callback(a))).toThrow("ended");
  });
  it("requires the exact plan scope, not identity or substring", () => {
    expect(hasChatGptPlanScope("openid email profile")).toBe(false);
    expect(hasChatGptPlanScope("chatgpt.tokens.use.direct.extra")).toBe(false);
    expect(hasChatGptPlanScope("openid\tchatgpt.tokens.use.direct email")).toBe(true);
  });
});
