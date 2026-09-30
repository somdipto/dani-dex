// Public-client protocol foundation only. No listener, network calls, token storage or UI yet.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const AUTHORIZATION_ENDPOINT = "https://auth.openai.com/api/accounts/authorize";
const RESOURCE = "https://api.openai.com/v1";
const INITIAL_CLIENT = "dynamic_agent_client";
const REQUESTED_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

export interface ChatGptAuthorizationOptions {
  redirectUri: string;
  hostId: string;
  appName: string;
  clientId?: string;
  idTokenHint?: string;
  loginHint?: string;
}

export type ChatGptCallbackResult =
  | { status: "denied"; error: string }
  | { status: "code"; code: string; clientId: string; tokenForm: URLSearchParams };

/** Must be created only after the owner has started a listener on the exact callback URI. */
export class ChatGptAuthorizationAttempt {
  readonly authorizationUrl: string;
  readonly nonce: string;
  readonly #state: string;
  readonly #verifier: string;
  readonly #redirect: URL;
  readonly #clientId: string | undefined;
  #consumed = false;

  constructor(options: ChatGptAuthorizationOptions) {
    this.#redirect = loopbackCallback(options.redirectUri);
    if (!options.hostId.trim() || !options.appName.trim()) throw new Error("App name and stable host ID are required.");
    if (options.clientId !== undefined) validateIssuedClient(options.clientId);
    this.#clientId = options.clientId;
    this.#state = randomBytes(32).toString("base64url");
    this.nonce = randomBytes(32).toString("base64url");
    this.#verifier = randomBytes(32).toString("base64url");
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: options.clientId ?? INITIAL_CLIENT,
      redirect_uri: this.#redirect.href,
      ext_agent_host_id: options.hostId,
      ...(!options.clientId ? { agent_name_hint: options.appName } : {}),
      ...(options.clientId && options.idTokenHint ? { id_token_hint: options.idTokenHint } : {}),
      ...(options.clientId && options.loginHint ? { login_hint: options.loginHint } : {}),
      scope: REQUESTED_SCOPES,
      resource: RESOURCE,
      state: this.#state,
      nonce: this.nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(this.#verifier).digest("base64url"),
    }).toString();
    this.authorizationUrl = url.href;
  }

  /** State/path validation precedes any result use. Accepted success or denial is single-use. */
  consumeCallback(callbackUri: string): ChatGptCallbackResult {
    if (this.#consumed) throw new Error("The authorization attempt has ended.");
    const callback = new URL(callbackUri);
    if (
      callback.origin !== this.#redirect.origin ||
      callback.pathname !== this.#redirect.pathname ||
      callback.hash ||
      callback.username ||
      callback.password
    ) {
      throw new Error("Unexpected authorization callback.");
    }
    for (const key of ["state", "code", "client_id", "error"]) {
      if (callback.searchParams.getAll(key).length > 1) throw new Error("Duplicate authorization callback parameter.");
    }
    const received = Buffer.from(callback.searchParams.get("state") ?? "");
    const expected = Buffer.from(this.#state);
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      throw new Error("Authorization state mismatch.");
    // A state-authenticated callback ends this attempt, including malformed registration.
    this.#consumed = true;
    const error = callback.searchParams.get("error");
    if (error) return { status: "denied", error };
    const code = callback.searchParams.get("code");
    if (!code?.trim()) throw new Error("Authorization code is missing.");
    const supplied = callback.searchParams.get("client_id");
    if (this.#clientId && supplied !== null && supplied !== this.#clientId)
      throw new Error("Authorization client mismatch.");
    const clientId = supplied ?? this.#clientId;
    if (!clientId) throw new Error("Registration did not return an issued client ID.");
    validateIssuedClient(clientId);
    return {
      status: "code",
      code,
      clientId,
      tokenForm: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: this.#verifier,
        redirect_uri: this.#redirect.href,
        resource: RESOURCE,
      }),
    };
  }

  get ended(): boolean {
    return this.#consumed;
  }

  cancel(): void {
    this.#consumed = true;
  }
}

export function hasChatGptPlanScope(grantedScope: string): boolean {
  return grantedScope.split(/\s+/u).includes("chatgpt.tokens.use.direct");
}

function validateIssuedClient(value: string): void {
  if (!value.trim() || value !== value.trim() || value === INITIAL_CLIENT)
    throw new Error("An issued client ID is required.");
}

function loopbackCallback(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/auth/callback" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("Use a port-bound HTTP 127.0.0.1 /auth/callback URI.");
  }
  return url;
}
