/**
 * Dani-Dex's account sign-in against Supabase Auth, spoken over its REST API.
 *
 * This is the protocol `@supabase/supabase-js` speaks, trimmed to what a desktop app needs:
 * emailed codes, browser sign-in with PKCE, token refresh and the user record. It runs in the
 * main process only, so the refresh token never reaches a renderer and is stored the same way
 * the account session always was - encrypted with the operating system's key store.
 *
 * The project URL and publishable key are public by design. What keeps an account safe is the
 * PKCE verifier, which stays in this process, and the redirect allow-list on the project.
 */

import { createHash, randomBytes } from "node:crypto";
import { CENTRAL_AUTH_PROVIDERS, type CentralAuthProvider, type CentralAuthUser } from "@dani-dex/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@dani-dex/contracts/runtime-values";
import { AuthApiError, parseRetryAfterSeconds } from "./account-api-error";

export const SUPABASE_AUTH_REDIRECT_URL = "dani-dex://auth/callback";

/** Supabase sends six-digit email codes unless the project is set otherwise. */
export const SUPABASE_EMAIL_CODE_LENGTH = 6;

/** Supabase's default: one email per address per minute, and a code that lasts an hour. */
export const SUPABASE_EMAIL_RESEND_INTERVAL_MS = 60_000;
export const SUPABASE_EMAIL_CODE_LIFETIME_MS = 60 * 60_000;

/** The project this build signs in to, unless the environment names another. */
export const DEFAULT_SUPABASE_AUTH_CONFIG: SupabaseAuthConfig = {
  url: "https://xcgqotcxtnrycphxwmju.supabase.co",
  publishableKey: "sb_publishable_HpWsB6enn-fmA570-y6XUg_-kxUvP4x",
};

export interface SupabaseAuthConfig {
  url: string;
  publishableKey: string;
}

export interface SupabaseSession {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

export interface SupabaseSignIn {
  session: SupabaseSession;
  user: CentralAuthUser;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 15_000;
const API_VERSION = "2024-01-01";

export function readSupabaseAuthConfig(
  env: { url?: string; publishableKey?: string },
  fallback: SupabaseAuthConfig = DEFAULT_SUPABASE_AUTH_CONFIG,
): SupabaseAuthConfig {
  const url = new URL(env.url?.trim() || fallback.url);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.pathname !== "/") {
    throw new Error("DANI_DEX_SUPABASE_URL must be an HTTPS origin, or an HTTP loopback origin.");
  }
  const publishableKey = env.publishableKey?.trim() || fallback.publishableKey;
  if (!/^[A-Za-z0-9._-]{20,512}$/u.test(publishableKey)) {
    throw new Error("DANI_DEX_SUPABASE_PUBLISHABLE_KEY is not a Supabase publishable key.");
  }
  return { url: url.origin, publishableKey };
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export class SupabaseAuthClient {
  readonly #config: SupabaseAuthConfig;
  readonly #fetch: Fetcher;

  constructor(config: SupabaseAuthConfig, fetcher: Fetcher = fetch) {
    this.#config = config;
    this.#fetch = fetcher;
  }

  /** The browser sign-ins the project has switched on. Also the cheapest proof the service is up. */
  async enabledProviders(timeoutMs = REQUEST_TIMEOUT_MS): Promise<CentralAuthProvider[]> {
    const settings = await this.#call("GET", "/settings", { timeoutMs });
    const external = isDynamicRecord(settings.external) ? settings.external : {};
    return CENTRAL_AUTH_PROVIDERS.filter((provider) => external[provider] === true);
  }

  /**
   * Emails a sign-in code, creating the account on first use.
   *
   * The PKCE challenge rides along so the link in the same email also works: it opens
   * `dani-dex://auth/callback` with a code this process can exchange.
   */
  async sendEmailCode(email: string, pkce: PkcePair): Promise<void> {
    await this.#call("POST", "/otp", {
      query: { redirect_to: SUPABASE_AUTH_REDIRECT_URL },
      body: {
        email,
        create_user: true,
        data: {},
        code_challenge: pkce.challenge,
        code_challenge_method: "s256",
      },
    });
  }

  async verifyEmailCode(email: string, code: string): Promise<SupabaseSignIn> {
    return decodeSignIn(await this.#call("POST", "/verify", { body: { type: "email", email, token: code } }));
  }

  /** Where to send the browser for a provider sign-in. Opening it has no effect until the user agrees. */
  authorizeUrl(provider: CentralAuthProvider, pkce: PkcePair): string {
    const url = new URL("/auth/v1/authorize", this.#config.url);
    url.searchParams.set("provider", provider);
    url.searchParams.set("redirect_to", SUPABASE_AUTH_REDIRECT_URL);
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", "s256");
    return url.toString();
  }

  async exchangeCode(code: string, verifier: string): Promise<SupabaseSignIn> {
    return decodeSignIn(
      await this.#call("POST", "/token", {
        query: { grant_type: "pkce" },
        body: { auth_code: code, code_verifier: verifier },
      }),
    );
  }

  async refresh(refreshToken: string, timeoutMs?: number): Promise<SupabaseSignIn> {
    return decodeSignIn(
      await this.#call("POST", "/token", {
        query: { grant_type: "refresh_token" },
        body: { refresh_token: refreshToken },
        timeoutMs,
      }),
    );
  }

  async getUser(accessToken: string, timeoutMs?: number): Promise<CentralAuthUser> {
    return decodeSupabaseUser(await this.#call("GET", "/user", { accessToken, timeoutMs }));
  }

  async updateName(accessToken: string, name: string): Promise<CentralAuthUser> {
    return decodeSupabaseUser(
      await this.#call("PUT", "/user", { accessToken, body: { data: { full_name: name, name } } }),
    );
  }

  /** Ends this device's session on the server. The caller forgets the tokens whatever this says. */
  async signOut(accessToken: string): Promise<void> {
    await this.#call("POST", "/logout", { accessToken, query: { scope: "local" } });
  }

  async #call(
    method: "GET" | "POST" | "PUT",
    path: string,
    options: {
      accessToken?: string;
      body?: DynamicRecord;
      query?: Record<string, string>;
      timeoutMs?: number;
    } = {},
  ): Promise<DynamicRecord> {
    const url = new URL(`/auth/v1${path}`, this.#config.url);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = {
      apikey: this.#config.publishableKey,
      "X-Supabase-Api-Version": API_VERSION,
    };
    // A publishable key is not a JWT, so it is never sent as a bearer token; only a user's own
    // access token is.
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
    if (options.body) headers["Content-Type"] = "application/json";
    const response = await this.#fetch(url, {
      method,
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw await supabaseError(response);
    if (response.status === 204) return {};
    const text = await response.text();
    if (!text) return {};
    const value = JSON.parse(text);
    return isDynamicRecord(value) ? value : {};
  }
}

/**
 * Supabase's error, in the account-service vocabulary the sign-in screen already speaks.
 *
 * Supabase says `otp_expired` for a wrong code as well as a stale one, so it becomes
 * `invalid_sign_in_code`: the user can retype it, and still ask for a new one.
 */
async function supabaseError(response: Response): Promise<AuthApiError> {
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("Retry-After"));
  let supabaseCode = "";
  let message = "";
  try {
    const body = await response.json();
    if (isDynamicRecord(body)) {
      supabaseCode = firstText(body.error_code, body.code, body.error) ?? "";
      message = firstText(body.msg, body.message, body.error_description) ?? "";
    }
  } catch {
    // Not JSON. The status still says enough.
  }
  const mapped = mapSupabaseError(response.status, supabaseCode, message);
  return new AuthApiError(response.status, mapped.code, mapped.message, retryAfterSeconds);
}

export function mapSupabaseError(status: number, code: string, message: string): { code: string; message: string } {
  switch (code) {
    case "otp_expired":
    case "invalid_credentials":
      return {
        code: "invalid_sign_in_code",
        message: "That code is wrong or has expired. Check it, or send a new one.",
      };
    case "email_address_invalid":
    case "validation_failed":
      return { code: "invalid_email", message: "Enter a valid email address." };
    case "over_email_send_rate_limit":
      return {
        code: "email_delivery_rate_limited",
        message: "A code was sent to this address recently. Wait a minute, then try again.",
      };
    case "over_request_rate_limit":
      return { code: "rate_limited", message: "Too many attempts. Wait a moment, then try again." };
    case "signup_disabled":
    case "email_provider_disabled":
      return { code: "sign_up_disabled", message: "New accounts are closed right now." };
    case "provider_disabled":
      return { code: "provider_disabled", message: "That sign-in option is not switched on yet." };
    case "flow_state_not_found":
    case "flow_state_expired":
    case "bad_code_verifier":
      return { code: "provider_sign_in_expired", message: "That sign-in link has expired. Start again from Dani-Dex." };
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "session_not_found":
    case "session_expired":
    case "bad_jwt":
    case "user_not_found":
      return { code: "unauthorized", message: "Your session has ended. Sign in again." };
    default:
      break;
  }
  if (status === 429) return { code: "rate_limited", message: "Too many attempts. Wait a moment, then try again." };
  if (status === 401 || status === 403)
    return { code: "unauthorized", message: "Your session has ended. Sign in again." };
  if (status >= 500) return { code: "auth_api_error", message: "The account service returned an error." };
  return { code: "auth_api_error", message: message || "The account service returned an error." };
}

function decodeSignIn(value: DynamicRecord): SupabaseSignIn {
  const accessToken = value.access_token;
  const refreshToken = value.refresh_token;
  if (!isString(accessToken) || !accessToken || !isString(refreshToken) || !refreshToken) {
    throw new Error("The account service returned an invalid session.");
  }
  const expiresAt = isNumber(value.expires_at)
    ? value.expires_at * 1_000
    : Date.now() + (isNumber(value.expires_in) ? value.expires_in : 3_600) * 1_000;
  return {
    session: { accessToken, refreshToken, expiresAt },
    user: decodeSupabaseUser(value.user),
  };
}

export function decodeSupabaseUser(value: unknown): CentralAuthUser {
  if (!isDynamicRecord(value) || !isString(value.id) || !value.id) {
    throw new Error("The account service returned an invalid user.");
  }
  const metadata = isDynamicRecord(value.user_metadata) ? value.user_metadata : {};
  const firstString = (...candidates: unknown[]) => firstText(...candidates) ?? null;
  return {
    id: value.id,
    email: firstString(value.email, metadata.email) ?? "",
    name: firstString(metadata.full_name, metadata.name, metadata.user_name),
    avatarUrl: firstString(metadata.avatar_url, metadata.picture),
  };
}

export function decodeStoredSupabaseSession(value: unknown): SupabaseSession | null {
  if (!isDynamicRecord(value)) return null;
  const { accessToken, refreshToken, expiresAt } = value;
  if (!isString(accessToken) || !isString(refreshToken) || !isNumber(expiresAt)) return null;
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt };
}

/** The part of an `dani-dex://auth/callback` link a sign-in needs. Supabase may put it in the fragment. */
export function parseAuthCallbackParameters(url: URL): { code: string } | { error: string } | null {
  const parameters = new URLSearchParams(url.search);
  if (url.hash.length > 1) {
    for (const [key, value] of new URLSearchParams(url.hash.slice(1))) {
      if (!parameters.has(key)) parameters.set(key, value);
    }
  }
  const code = parameters.get("code");
  if (code) return { code };
  const error = parameters.get("error_description") ?? parameters.get("error");
  if (error) return { error: error.replaceAll("+", " ").slice(0, 300) };
  return null;
}

function firstText(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (isString(candidate) && candidate.trim()) return candidate.trim();
  }
  return undefined;
}
