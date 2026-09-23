import { describe, expect, it, vi } from "vitest";
import { parseDeepLink } from "./deep-link-router";
import {
  createPkcePair,
  decodeSupabaseUser,
  mapSupabaseError,
  parseAuthCallbackParameters,
  readSupabaseAuthConfig,
  SUPABASE_AUTH_REDIRECT_URL,
  SupabaseAuthClient,
} from "./supabase-auth";

const config = { url: "https://project.supabase.co", publishableKey: "sb_publishable_test_key_1234567890" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("SupabaseAuthClient", () => {
  it("builds a PKCE authorize URL that returns to the app", () => {
    const client = new SupabaseAuthClient(config, vi.fn());
    const pkce = createPkcePair();
    const url = new URL(client.authorizeUrl("github", pkce));
    expect(url.origin + url.pathname).toBe("https://project.supabase.co/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("github");
    expect(url.searchParams.get("redirect_to")).toBe(SUPABASE_AUTH_REDIRECT_URL);
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.toString()).not.toContain(pkce.verifier);
  });

  it("exchanges a code with the verifier and never sends the key as a bearer token", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        access_token: "access",
        refresh_token: "refresh",
        expires_at: 2_000_000_000,
        user: { id: "u1", email: "a@b.co", user_metadata: { full_name: "Ada", avatar_url: "https://x/y.png" } },
      }),
    );
    const client = new SupabaseAuthClient(config, fetcher);
    const signIn = await client.exchangeCode("the-code", "the-verifier");
    expect(signIn).toEqual({
      session: { accessToken: "access", refreshToken: "refresh", expiresAt: 2_000_000_000_000 },
      user: { id: "u1", email: "a@b.co", name: "Ada", avatarUrl: "https://x/y.png" },
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://project.supabase.co/auth/v1/token?grant_type=pkce");
    expect(JSON.parse(String(init?.body))).toEqual({ auth_code: "the-code", code_verifier: "the-verifier" });
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe(config.publishableKey);
    expect(headers.get("authorization")).toBeNull();
  });

  it("asks for a code whose email link also comes back to the app", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse({}));
    const client = new SupabaseAuthClient(config, fetcher);
    const pkce = createPkcePair();
    await client.sendEmailCode("a@b.co", pkce);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(new URL(String(url)).searchParams.get("redirect_to")).toBe(SUPABASE_AUTH_REDIRECT_URL);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      email: "a@b.co",
      create_user: true,
      code_challenge: pkce.challenge,
      code_challenge_method: "s256",
    });
  });

  it("lists only the providers the project has switched on", async () => {
    const client = new SupabaseAuthClient(
      config,
      vi.fn(async () => jsonResponse({ external: { github: true, google: false, email: true } })),
    );
    await expect(client.enabledProviders()).resolves.toEqual(["github"]);
  });

  it("speaks the sign-in screen's error vocabulary", async () => {
    const client = new SupabaseAuthClient(
      config,
      vi.fn(async () => jsonResponse({ code: "otp_expired", message: "Token has expired or is invalid" }, 403)),
    );
    await expect(client.verifyEmailCode("a@b.co", "123456")).rejects.toMatchObject({
      status: 403,
      code: "invalid_sign_in_code",
    });
    expect(mapSupabaseError(429, "over_email_send_rate_limit", "").code).toBe("email_delivery_rate_limited");
    expect(mapSupabaseError(400, "refresh_token_not_found", "").code).toBe("unauthorized");
  });
});

describe("Supabase sign-in helpers", () => {
  it("reads a code or an error from the callback, query or fragment", () => {
    expect(parseAuthCallbackParameters(new URL("dani-dex://auth/callback?code=abc"))).toEqual({ code: "abc" });
    expect(
      parseAuthCallbackParameters(new URL("dani-dex://auth/callback#error=access_denied&error_description=Denied+it")),
    ).toEqual({ error: "Denied it" });
    expect(parseAuthCallbackParameters(new URL("dani-dex://auth/callback"))).toBeNull();
  });

  it("routes the callback as an account link, never a renderer link", () => {
    expect(parseDeepLink("dani-dex://auth/callback?code=abc")).toEqual({
      kind: "account-auth",
      result: { code: "abc" },
    });
    expect(parseDeepLink("dani-dex://auth/other?code=abc")).toBeNull();
  });

  it("takes a provider's name and photo, and tolerates a missing email", () => {
    expect(decodeSupabaseUser({ id: "u", user_metadata: { user_name: "octo", picture: "https://p" } })).toEqual({
      id: "u",
      email: "",
      name: "octo",
      avatarUrl: "https://p",
    });
  });

  it("rejects a project URL that is not an HTTPS origin", () => {
    expect(() => readSupabaseAuthConfig({ url: "http://example.com" })).toThrow();
    expect(readSupabaseAuthConfig({}).url).toBe("https://xcgqotcxtnrycphxwmju.supabase.co");
  });
});
