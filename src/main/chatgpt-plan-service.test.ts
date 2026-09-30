import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { ChatGptPlanService } from "./chatgpt-plan-service";
import { ChatGptPlanStore } from "./chatgpt-plan-store";
import { OPENAI_ISSUER } from "./chatgpt-plan-tokens";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((h) => rm(h, { recursive: true, force: true })));
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "dani-oauth-service-"));
  homes.push(home);
  const store = new ChatGptPlanStore(join(home, "accounts"), {
    encrypt: (s) => Buffer.from(Buffer.from(s).map((b) => b ^ 0x55)),
    decrypt: (b) =>
      Buffer.from(b)
        .map((n) => n ^ 0x55)
        .toString(),
  });
  await store.load();
  const pair = await generateKeyPair("RS256"),
    keys = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test" }] };
  let nonce = "",
    requests = 0,
    deny = false;
  const fetchImpl: typeof fetch = async (url) => {
    if (String(url).endsWith("openid-configuration"))
      return Response.json({
        issuer: OPENAI_ISSUER,
        authorization_endpoint: `${OPENAI_ISSUER}/api/accounts/authorize`,
        token_endpoint: `${OPENAI_ISSUER}/api/accounts/oauth/token`,
        jwks_uri: `${OPENAI_ISSUER}/.well-known/jwks.json`,
      });
    if (String(url).endsWith("jwks.json")) return Response.json(keys);
    requests++;
    const id = await new SignJWT({ nonce, email: "selected@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(OPENAI_ISSUER)
      .setAudience("issued")
      .setSubject("selected")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(pair.privateKey);
    return Response.json({
      access_token: `access-${requests}`,
      refresh_token: `refresh-${requests}`,
      id_token: id,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid offline_access chatgpt.tokens.use.direct resource.invoke",
    });
  };
  const browser = async (url: string) => {
    const auth = new URL(url);
    nonce = auth.searchParams.get("nonce") ?? "";
    const callback = new URL(auth.searchParams.get("redirect_uri") ?? "");
    callback.search = new URLSearchParams({
      state: auth.searchParams.get("state") ?? "",
      ...(deny ? { error: "access_denied" } : { code: "code", client_id: "issued" }),
    }).toString();
    expect((await fetch(callback)).status).toBe(200);
  };
  return {
    store,
    service: new ChatGptPlanService(store, browser, fetchImpl),
    count: () => requests,
    deny: () => {
      deny = true;
    },
  };
}
describe("ChatGPT connection lifecycle", () => {
  it("completes real loopback, verified identity and encrypted registration before plan enabled", async () => {
    const { store, service } = await fixture();
    const record = await service.connect();
    expect(record.subject).toBe("selected");
    expect(store.read("issued")).toEqual(record);
    expect(service.planEnabled("issued")).toBe(true);
  });
  it("refuses overlapping connections before the listener finishes binding", async () => {
    const f = await fixture();
    const first = f.service.connect();
    await expect(f.service.connect()).rejects.toThrow("already active");
    await first;
    expect(f.count()).toBe(1);
  });
  it("denied reauthorization keeps prior selected credentials", async () => {
    const f = await fixture();
    await f.service.connect();
    const old = f.store.read("issued");
    f.deny();
    await expect(f.service.connect("issued")).rejects.toThrow("not approved");
    expect(f.count()).toBe(1);
    expect(f.store.read("issued")).toEqual(old);
  });
  it("coalesces refresh rotation and disconnect clears only the selected app registration", async () => {
    const f = await fixture();
    await f.service.connect();
    const [a, b] = await Promise.all([f.service.refresh("issued"), f.service.refresh("issued")]);
    expect(a.refreshToken).toBe("refresh-2");
    expect(a).toEqual(b);
    expect(f.count()).toBe(2);
    await f.service.disconnect("issued");
    expect(f.store.read("issued")).toBeNull();
    expect(f.service.planEnabled("issued")).toBe(false);
  });
});
