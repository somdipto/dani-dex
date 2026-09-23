import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CentralAuthManager } from "./central-auth-manager";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const user = { id: "user-1", email: "ada@example.com", user_metadata: { full_name: "Ada" } };

function session(accessToken: string, refreshToken: string, expiresInSeconds = 3_600) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1_000) + expiresInSeconds,
    user,
  };
}

/** A stand-in for Supabase Auth that records what it was asked. */
function fakeSupabase(providers: Record<string, boolean> = { github: true, google: false }) {
  interface RecordedBody {
    token?: string;
    auth_code?: string;
    code_verifier?: string;
    data?: { name?: string };
  }
  const calls: { path: string; body: RecordedBody | null; bearer: string | null }[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const bearer = new Headers(init?.headers).get("authorization");
    calls.push({ path: `${url.pathname}${url.search}`, body, bearer });
    const route = `${init?.method ?? "GET"} ${url.pathname}`;
    if (route === "GET /auth/v1/settings") return Response.json({ external: { ...providers, email: true } });
    if (route === "POST /auth/v1/otp") return Response.json({});
    if (route === "POST /auth/v1/verify") {
      if (body?.token !== "123456") {
        return Response.json({ code: "otp_expired", message: "Token has expired or is invalid" }, { status: 403 });
      }
      return Response.json(session("access-email", "refresh-email"));
    }
    if (route === "POST /auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
      return Response.json(session("access-github", "refresh-github"));
    }
    if (route === "POST /auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      return Response.json(session("access-refreshed", "refresh-next"));
    }
    if (route === "GET /auth/v1/user") return Response.json(user);
    if (route === "PUT /auth/v1/user")
      return Response.json({ ...user, user_metadata: { full_name: body?.data?.name } });
    if (route === "POST /auth/v1/logout") return new Response(null, { status: 204 });
    return Response.json({ message: "unexpected" }, { status: 500 });
  });
  return { fetcher, calls };
}

async function createManager(fake = fakeSupabase(), storagePath?: string) {
  const root = await mkdtemp(join(tmpdir(), "dani-dex-supabase-auth-"));
  roots.push(root);
  const opened: string[] = [];
  const path = storagePath ?? join(root, "session.bin");
  const manager = new CentralAuthManager({
    apiUrl: "https://api.example.invalid",
    storagePath: path,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
    fetch: vi.fn(async () => {
      throw new Error("the account API must not be called");
    }),
    supabase: {
      config: { url: "https://project.supabase.co", publishableKey: "sb_publishable_test_key_1234567890" },
      fetch: fake.fetcher,
      openExternal: async (url) => {
        opened.push(url);
      },
    },
  });
  return { manager, opened, storagePath: path, fake };
}

describe("CentralAuthManager with Supabase", () => {
  it("signs in with an emailed six-digit code and keeps the session across restarts", async () => {
    const { manager, storagePath, fake } = await createManager();
    await expect(manager.initialize()).resolves.toEqual({ status: "signed_out" });
    const sent = await manager.requestEmailCode(" Ada@Example.com ");
    expect(sent).toMatchObject({ status: "code_sent", email: "ada@example.com", codeLength: 6 });
    if (sent.status !== "code_sent") throw new Error("expected a code");

    const wrong = await manager.verifyEmailCode(sent.challengeId, "000000");
    expect(wrong).toMatchObject({ status: "code_sent", issue: { code: "invalid_sign_in_code" } });

    const signedIn = await manager.verifyEmailCode(sent.challengeId, "123456");
    expect(signedIn).toEqual({
      status: "signed_in",
      user: { id: "user-1", email: "ada@example.com", name: "Ada", avatarUrl: null },
    });
    const stored = JSON.parse(await readFile(storagePath, "utf8").then((v) => Buffer.from(v, "base64").toString()));
    expect(stored).toMatchObject({
      version: 3,
      supabase: { accessToken: "access-email", refreshToken: "refresh-email" },
    });

    const restarted = await createManager(fake, storagePath);
    await expect(restarted.manager.initialize()).resolves.toMatchObject({ status: "signed_in" });
    expect(fake.calls.at(-1)).toMatchObject({ path: "/auth/v1/user", bearer: "Bearer access-email" });
  });

  it("signs in with GitHub through the browser and the dani-dex:// callback", async () => {
    const { manager, opened, fake } = await createManager();
    await manager.initialize();
    await expect(manager.getSignInOptions()).resolves.toEqual({ providers: ["github"], onlineServices: false });

    // A callback nobody asked for does nothing.
    await expect(manager.receiveAuthCallback({ code: "forged" })).resolves.toBe(false);

    await expect(manager.signInWithProvider("github")).resolves.toEqual({ status: "signing_in", provider: "github" });
    expect(opened).toHaveLength(1);
    const authorize = new URL(opened[0] ?? "");
    expect(authorize.searchParams.get("redirect_to")).toBe("dani-dex://auth/callback");

    await expect(manager.receiveAuthCallback({ code: "real-code" })).resolves.toBe(true);
    expect(manager.getState()).toMatchObject({ status: "signed_in", user: { id: "user-1" } });
    const exchange = fake.calls.find((call) => call.path === "/auth/v1/token?grant_type=pkce");
    expect(exchange?.body?.auth_code).toBe("real-code");
    // The verifier matches the challenge the browser was given.
    const { createHash } = await import("node:crypto");
    const verifier = String(exchange?.body?.code_verifier);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      authorize.searchParams.get("code_challenge"),
    );

    // A replay after sign-in is inert.
    await expect(manager.receiveAuthCallback({ code: "real-code" })).resolves.toBe(false);
  });

  it("refuses a provider that is not switched on, and cancels a waiting browser sign-in", async () => {
    const { manager, opened } = await createManager();
    await manager.initialize();
    await expect(manager.signInWithProvider("google")).resolves.toMatchObject({
      status: "error",
      issue: { code: "provider_disabled" },
    });
    expect(opened).toHaveLength(0);
    await manager.signInWithProvider("github");
    await expect(manager.cancelProviderSignIn()).resolves.toEqual({ status: "signed_out" });
    await expect(manager.receiveAuthCallback({ code: "late" })).resolves.toBe(false);
  });

  it("refreshes an expired access token before using it, and signs out cleanly", async () => {
    const fake = fakeSupabase();
    fake.fetcher.mockImplementationOnce(async () => Response.json({ external: { github: true } }));
    const { manager, storagePath } = await createManager(fake);
    await manager.initialize();
    await manager.signInWithProvider("github");
    // Hand back a session that is already about to lapse.
    fake.fetcher.mockImplementationOnce(async () => Response.json(session("stale", "refresh-old", 10)));
    await manager.receiveAuthCallback({ code: "c" });
    await manager.updateName("Grace");
    const update = fake.calls.find((call) => call.path === "/auth/v1/user" && call.body);
    expect(update?.bearer).toBe("Bearer access-refreshed");
    expect(manager.getState()).toMatchObject({ status: "signed_in", user: { name: "Grace" } });

    await expect(manager.logout()).resolves.toEqual({ status: "signed_out" });
    await expect(readFile(storagePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("answers server-only features as unavailable instead of calling the account API", async () => {
    const { manager } = await createManager();
    await manager.initialize();
    expect(manager.onlineServicesAvailable).toBe(false);
    await expect(manager.listRemoteHosts()).rejects.toMatchObject({ code: "online_service_unavailable" });
    await expect(manager.createTeamAuthTicket("server")).rejects.toMatchObject({ code: "online_service_unavailable" });
    await expect(manager.updateAvatar(null)).rejects.toMatchObject({ code: "online_service_unavailable" });
  });
});
