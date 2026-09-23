import type { CentralAuthManager } from "./central-auth-manager";

export interface OpenAiRealtimeSession {
  clientSecret: string;
  expiresAt: number;
  model: string;
}

interface RealtimeSessionResponse {
  clientSecret: string;
  expiresAt: number;
  model: string;
}

/**
 * Mints a short-lived browser credential through Dani-Dex's authenticated account API. The desktop
 * never receives or stores the server OpenAI API key, and a Codex OAuth token is never reused here.
 */
export class OpenAiRealtimeSessionService {
  constructor(private readonly auth: Pick<CentralAuthManager, "requestAuthorized">) {}

  create(signal?: AbortSignal): Promise<OpenAiRealtimeSession> {
    return this.auth.requestAuthorized(
      "/v1/realtime/client-secret",
      { method: "POST", headers: { "Content-Type": "application/json" }, signal },
      decodeRealtimeSession,
      30_000,
    );
  }
}

export function decodeRealtimeSession(value: unknown): RealtimeSessionResponse {
  if (!isRecord(value)) throw new Error("The account service returned an invalid Realtime session.");
  // POST /v1/realtime/client_secrets returns `value` and `expires_at` at the top level; the older
  // sessions endpoint nested them under `client_secret`. Accept both, plus the desktop's own shape.
  const nested = isRecord(value.client_secret) ? value.client_secret : null;
  const secretValue = nested ? nested.value : typeof value.value === "string" ? value.value : value.clientSecret;
  const expiresAt = nested
    ? nested.expires_at
    : typeof value.expires_at === "number"
      ? value.expires_at
      : value.expiresAt;
  const model = isRecord(value.session) ? value.session.model : value.model;
  if (
    typeof secretValue !== "string" ||
    secretValue.length < 16 ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    typeof model !== "string" ||
    !model.trim()
  ) {
    throw new Error("The account service returned an invalid Realtime session.");
  }
  return { clientSecret: secretValue, expiresAt, model };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
