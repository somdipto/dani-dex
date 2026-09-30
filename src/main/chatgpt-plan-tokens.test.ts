import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  decodeChatGptTokens,
  exchangeChatGptTokens,
  loadChatGptSigningKeys,
  OPENAI_ISSUER,
  verifyChatGptIdentity,
} from "./chatgpt-plan-tokens";

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = { keys: [{ ...(await exportJWK(publicKey)), kid: "test" }] };
  const sign = (claims: { iss?: string; nonce?: string; email?: string } = {}) =>
    new SignJWT({ nonce: "nonce", email: "account@example.com", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(typeof claims.iss === "string" ? claims.iss : OPENAI_ISSUER)
      .setAudience("client")
      .setSubject("subject")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  return { keys, sign };
}
describe("ChatGPT verified token boundary", () => {
  it("verifies signature, client, nonce and selected account before returning identity", async () => {
    const { keys, sign } = await fixture();
    const jwt = await sign();
    expect(await verifyChatGptIdentity(jwt, keys, { clientId: "client", nonce: "nonce", subject: "subject" })).toEqual({
      subject: "subject",
      email: "account@example.com",
    });
    await expect(verifyChatGptIdentity(jwt, keys, { clientId: "other", nonce: "nonce" })).rejects.toThrow();
    await expect(verifyChatGptIdentity(jwt, keys, { clientId: "client", nonce: "wrong" })).rejects.toThrow();
    await expect(verifyChatGptIdentity(jwt, keys, { clientId: "client", subject: "other" })).rejects.toThrow();
  });
  it("rejects forged, expired and wrong-issuer identity", async () => {
    const a = await fixture(),
      b = await fixture();
    await expect(verifyChatGptIdentity(await a.sign(), b.keys, { clientId: "client" })).rejects.toThrow();
    await expect(
      verifyChatGptIdentity(await a.sign({ iss: "https://other.invalid" }), a.keys, { clientId: "client" }),
    ).rejects.toThrow();
    await expect(
      verifyChatGptIdentity(await a.sign(), a.keys, { clientId: "client", now: new Date(Date.now() + 7_200_000) }),
    ).rejects.toThrow();
  });
  it("requires complete tokens and refuses non-bearer or missing refresh", () => {
    expect(() =>
      decodeChatGptTokens({
        access_token: "access",
        id_token: "id",
        expires_in: 3600,
        scope: "openid",
        token_type: "Bearer",
      }),
    ).toThrow();
  });
  it("rejects discovery substitution before retrieving external keys", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return Response.json({
        issuer: OPENAI_ISSUER,
        authorization_endpoint: `${OPENAI_ISSUER}/api/accounts/authorize`,
        token_endpoint: `${OPENAI_ISSUER}/api/accounts/oauth/token`,
        jwks_uri: "https://external.invalid/keys",
      });
    };
    await expect(loadChatGptSigningKeys(fetchImpl)).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("uses the fixed token endpoint and does not expose external failure bodies", async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe(`${OPENAI_ISSUER}/api/accounts/oauth/token`);
      expect(init?.redirect).toBe("error");
      return new Response("private-token-error", { status: 400 });
    };
    await expect(exchangeChatGptTokens(new URLSearchParams({ code: "private-code" }), fetchImpl)).rejects.toThrow(
      "HTTP 400",
    );
  });
});
