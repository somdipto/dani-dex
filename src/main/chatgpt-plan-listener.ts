import { createServer, type Server } from "node:http";
import {
  ChatGptAuthorizationAttempt,
  type ChatGptAuthorizationOptions,
  type ChatGptCallbackResult,
} from "./chatgpt-plan-oauth";

export interface ChatGptLoopback {
  attempt: ChatGptAuthorizationAttempt;
  result: Promise<ChatGptCallbackResult>;
  cancel(): Promise<void>;
}

/** Bind before opening the browser. An unrelated request cannot consume or end the owner's attempt. */
export async function startChatGptLoopback(
  options: Omit<ChatGptAuthorizationOptions, "redirectUri">,
  timeoutMs = 5 * 60_000,
): Promise<ChatGptLoopback> {
  let attempt: ChatGptAuthorizationAttempt | undefined;
  let settled = false;
  let finish!: (value: ChatGptCallbackResult) => void;
  let fail!: (reason: Error) => void;
  const result = new Promise<ChatGptCallbackResult>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Cancellation may happen before a caller starts awaiting. It remains observable to that caller.
  void result.catch(() => undefined);
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const host = new URL(attempt?.authorizationUrl ?? "http://127.0.0.1").searchParams.get("redirect_uri");
    if (!attempt || !host || request.method !== "GET" || request.headers.host !== new URL(host).host) {
      response.writeHead(400).end("Invalid sign-in callback.");
      return;
    }
    try {
      if (!request.url?.startsWith("/auth/callback?") || request.url.length > 16_384 || settled)
        throw new Error("Invalid callback.");
      const value = attempt.consumeCallback(new URL(request.url, host).href);
      settled = true;
      response
        .writeHead(200)
        .end(
          value.status === "code"
            ? "Return to Dani-Dex to finish connecting ChatGPT."
            : "Sign-in was not approved. Return to Dani-Dex.",
        );
      clearTimeout(timer);
      void close(server);
      finish(value);
    } catch {
      // Never reflect callback parameters, codes, state or an external error description.
      response.writeHead(400).end("Invalid sign-in callback. Return to Dani-Dex to try again.");
      if (attempt?.ended && !settled) {
        settled = true;
        clearTimeout(timer);
        void close(server);
        fail(new Error("ChatGPT sign-in callback was invalid. Try again."));
      }
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await close(server);
    throw new Error("ChatGPT callback listener did not bind.");
  }
  try {
    attempt = new ChatGptAuthorizationAttempt({
      ...options,
      redirectUri: `http://127.0.0.1:${address.port}/auth/callback`,
    });
  } catch (error) {
    await close(server);
    throw error;
  }
  const cancel = async () => {
    if (!settled) {
      settled = true;
      attempt?.cancel();
      fail(new Error("ChatGPT sign-in ended."));
    }
    clearTimeout(timer);
    await close(server);
  };
  const timer = setTimeout(() => {
    void cancel();
  }, timeoutMs);
  timer.unref?.();
  return { attempt, result, cancel };
}

function close(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}
