import type { WorkerBindings } from "./types";

const REALTIME_CLIENT_SECRET_URL = "https://api.openai.com/v1/realtime/client_secrets";
const DEFAULT_REALTIME_MODEL = "gpt-realtime";

export async function createOpenAiRealtimeClientSecret(
  bindings: Pick<WorkerBindings, "OPENAI_API_KEY" | "OPENAI_REALTIME_MODEL">,
  userId: string,
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): Promise<unknown> {
  const apiKey = bindings.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new OpenAiRealtimeError(503, "realtime_not_configured", "Realtime voice is not configured.");
  const model = bindings.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL;
  const safetyIdentifier = await sha256(userId);
  const response = await fetchImpl(REALTIME_CLIENT_SECRET_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyIdentifier,
    },
    body: JSON.stringify({ session: { type: "realtime", model } }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new OpenAiRealtimeError(502, "realtime_session_failed", "OpenAI could not start a Realtime session.");
  }
  return body;
}

export class OpenAiRealtimeError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "OpenAiRealtimeError";
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
