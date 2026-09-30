import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose";
import { z } from "zod";

export const OPENAI_ISSUER = "https://auth.openai.com";
export const OPENAI_TOKEN_ENDPOINT = `${OPENAI_ISSUER}/api/accounts/oauth/token`;
const tokenSchema = z.object({
  access_token: z.string().min(1).max(64_000),
  refresh_token: z.string().min(1).max(64_000),
  id_token: z.string().min(1).max(64_000),
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
  expires_in: z.number().int().positive().max(86_400),
  scope: z.string().max(4096),
  earliest_refresh_at: z.number().int().nonnegative().optional(),
});
export type ChatGptTokens = z.infer<typeof tokenSchema>;
export interface ChatGptIdentity {
  subject: string;
  email: string | null;
}

/** Parse only a complete token rotation. Never commit a partial response over a usable registration. */
export function decodeChatGptTokens(value: unknown): ChatGptTokens {
  return tokenSchema.parse(value);
}

export async function verifyChatGptIdentity(
  idToken: string,
  keys: JSONWebKeySet,
  expected: { clientId: string; nonce?: string; subject?: string; now?: Date },
): Promise<ChatGptIdentity> {
  const { payload } = await jwtVerify(idToken, createLocalJWKSet(keys), {
    issuer: OPENAI_ISSUER,
    audience: expected.clientId,
    requiredClaims: ["sub", "exp", "iat"],
    algorithms: ["RS256"],
    clockTolerance: 5,
    currentDate: expected.now,
  });
  if (!payload.sub || (expected.nonce !== undefined && payload.nonce !== expected.nonce))
    throw new Error("ChatGPT identity did not match the sign-in attempt.");
  if (expected.subject !== undefined && payload.sub !== expected.subject)
    throw new Error("ChatGPT account changed during sign-in.");
  if (typeof payload.iat !== "number" || payload.iat > (expected.now?.getTime() ?? Date.now()) / 1000 + 5)
    throw new Error("ChatGPT identity has an invalid issue time.");
  return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

/** Fixed production discovery prevents a callback or renderer from selecting a token/key destination. */
export async function loadChatGptSigningKeys(fetchImpl: typeof fetch = fetch): Promise<JSONWebKeySet> {
  const config = await readChatGptJson(
    fetchImpl,
    `${OPENAI_ISSUER}/.well-known/openid-configuration`,
    z.object({
      issuer: z.literal(OPENAI_ISSUER),
      authorization_endpoint: z.literal(`${OPENAI_ISSUER}/api/accounts/authorize`),
      token_endpoint: z.literal(OPENAI_TOKEN_ENDPOINT),
      jwks_uri: z.literal(`${OPENAI_ISSUER}/.well-known/jwks.json`),
    }),
  );
  const keys = await readChatGptJson(
    fetchImpl,
    config.jwks_uri,
    z.object({
      keys: z
        .array(z.object({ kty: z.string(), kid: z.string().optional() }).passthrough())
        .min(1)
        .max(100),
    }),
  );
  return keys;
}

export async function exchangeChatGptTokens(
  form: URLSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatGptTokens> {
  return readChatGptJson(fetchImpl, OPENAI_TOKEN_ENDPOINT, tokenSchema, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

export async function readChatGptJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`ChatGPT connection request failed (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length")) > 256 * 1024)
    throw new Error("ChatGPT connection response is too large.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("ChatGPT connection response is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) throw new Error("ChatGPT connection response is too large.");
      chunks.push(value);
    }
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    await reader.cancel();
  }
}
