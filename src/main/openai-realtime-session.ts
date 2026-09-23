import { isDynamicRecord as isRecord } from "@dani-dex/contracts/runtime-values";
import { type CredentialId, REALTIME_CREDENTIAL_ID } from "./provider-credential-store";

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

type RealtimeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const REALTIME_CLIENT_SECRET_URL = "https://api.openai.com/v1/realtime/client_secrets";
export const DEFAULT_REALTIME_MODEL = "gpt-realtime";

export const REALTIME_KEY_MISSING_MESSAGE = "Add your OpenAI API key in Settings > Voice to start a voice call.";

/**
 * Mints a short-lived browser credential from the user's own OpenAI API key (bring your own key).
 *
 * The key stays in the main process: the renderer only ever holds the ephemeral client secret, which
 * OpenAI scopes to one Realtime session and expires within minutes. A Codex OAuth token is never
 * reused here.
 */
export class OpenAiRealtimeSessionService {
  constructor(
    private readonly credentials: { get(id: CredentialId): string | null },
    private readonly fetchImpl: RealtimeFetch = fetch,
    private readonly model: string = DEFAULT_REALTIME_MODEL,
  ) {}

  async create(signal?: AbortSignal): Promise<OpenAiRealtimeSession> {
    const apiKey = this.credentials.get(REALTIME_CREDENTIAL_ID)?.trim();
    if (!apiKey) throw new Error(REALTIME_KEY_MISSING_MESSAGE);
    const timeout = AbortSignal.timeout(30_000);
    const response = await this.fetchImpl(REALTIME_CLIENT_SECRET_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: { type: "realtime", model: this.model } }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON: the status alone explains the failure.
    }
    if (response.status === 401) {
      throw new Error("OpenAI rejected the API key. Check it in Settings > Voice.");
    }
    if (!response.ok) {
      throw new Error(`OpenAI could not start a voice call (HTTP ${response.status}).${openAiErrorDetail(body)}`);
    }
    return decodeRealtimeSession(body);
  }
}

/** OpenAI's own error message, which names the fix (billing, model access, quota). Never the key. */
function openAiErrorDetail(body: unknown): string {
  if (!isRecord(body) || !isRecord(body.error) || typeof body.error.message !== "string") return "";
  return ` ${body.error.message.replaceAll(/sk-[A-Za-z0-9_-]{8,}/gu, "sk-…").slice(0, 300)}`;
}

export function decodeRealtimeSession(value: unknown): RealtimeSessionResponse {
  if (!isRecord(value)) throw new Error("OpenAI returned an invalid Realtime session.");
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
    throw new Error("OpenAI returned an invalid Realtime session.");
  }
  return { clientSecret: secretValue, expiresAt, model };
}
