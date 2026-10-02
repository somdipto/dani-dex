import { mkdir } from "node:fs/promises";
import type { AgentClient } from "../backend/agent-client";
import { CodexAppServerClient } from "../backend/app-server-client";
import { decodeRecordResponse, isRecord } from "../backend/protocol";

type RealtimeClient = AgentClient & {
  removeListener: (event: "notification", listener: (value: { method: string; params?: unknown }) => void) => unknown;
};

/** Separate official Codex login. Never uses a SIWC token or an API-key fallback. */
export class CodexRealtimeService {
  #client: RealtimeClient | null = null;
  #preparing: Promise<RealtimeClient> | null = null;
  #thread: string | null = null;
  #starting = false;
  #disposed = false;
  #generation = 0;
  #cancelNegotiation: (() => void) | null = null;
  constructor(
    private readonly home: string,
    private readonly executable: () => string | null,
    private readonly open: (url: string) => Promise<void>,
    private readonly factory: (executable: string, home: string) => RealtimeClient = (executable, home) =>
      new CodexAppServerClient(executable, 30_000, {
        arguments: ["-c", 'cli_auth_credentials_store="keyring"'],
        environment: () => {
          const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: home };
          delete env.OPENAI_API_KEY;
          delete env.CODEX_API_KEY;
          delete env.CHATGPT_ACCESS_TOKEN;
          return env;
        },
      }),
  ) {}
  async #ready(): Promise<RealtimeClient> {
    if (this.#disposed) throw new Error("Voice service is closed.");
    if (this.#client) return this.#client;
    if (!this.#preparing)
      this.#preparing = (async () => {
        const executable = this.executable();
        if (!executable) throw new Error("Download the ChatGPT runtime first.");
        await mkdir(this.home, { recursive: true, mode: 0o700 });
        const client = this.factory(executable, this.home);
        client.start();
        try {
          await client.request(
            "initialize",
            {
              clientInfo: { name: "dani-dex-voice", title: "Dani-Dex", version: "0.17.8" },
              capabilities: { experimentalApi: true },
            },
            decodeRecordResponse,
          );
          if (this.#disposed) throw new Error("Voice service is closed.");
          client.notify("initialized");
          this.#client = client;
          client.once("exit", () => {
            if (this.#client === client) {
              this.#client = null;
              this.#thread = null;
            }
          });
          return client;
        } catch (error) {
          await client.stop();
          throw error;
        }
      })().finally(() => {
        this.#preparing = null;
      });
    return this.#preparing;
  }
  async status(): Promise<{ connected: boolean }> {
    const client = await this.#ready();
    const response = await client.request("account/read", { refreshToken: true }, decodeRecordResponse);
    return { connected: isRecord(response.account) && response.account.type === "chatgpt" };
  }
  async connect(): Promise<void> {
    const client = await this.#ready();
    const response = await client.request("account/login/start", { type: "chatgpt" }, decodeRecordResponse);
    if (typeof response.authUrl !== "string") throw new Error("Codex did not return its ChatGPT sign-in URL.");
    const url = new URL(response.authUrl);
    if (url.protocol !== "https:" || url.hostname !== "auth.openai.com")
      throw new Error("Unexpected Codex sign-in destination.");
    await this.open(url.href);
  }
  async start(sdp: string, consent: boolean): Promise<{ sdp: string }> {
    if (!consent) throw new Error("Experimental plan-usage consent is required.");
    if (this.#starting || this.#thread) throw new Error("A voice session is already active.");
    if (!sdp.startsWith("v=0") || sdp.length > 100_000) throw new Error("Invalid WebRTC offer.");
    this.#starting = true;
    const generation = ++this.#generation;
    let client: RealtimeClient | null = null;
    try {
      client = await this.#ready();
      if (generation !== this.#generation) throw new Error("Voice start cancelled.");
      if (!(await this.status()).connected)
        throw new Error("Sign in with Codex's own ChatGPT login first. SIWC text login is separate.");
      if (generation !== this.#generation) throw new Error("Voice start cancelled.");
      const thread = await client.request(
        "thread/start",
        {
          cwd: this.home,
          approvalPolicy: "untrusted",
          sandbox: "read-only",
          developerInstructions:
            "Experimental voice demo only. Do not run tools, send messages, edit files or make commitments.",
        },
        decodeRecordResponse,
      );
      if (!isRecord(thread.thread) || typeof thread.thread.id !== "string")
        throw new Error("Codex did not create a voice thread.");
      this.#thread = thread.thread.id;
      const threadId = this.#thread;
      if (generation !== this.#generation) throw new Error("Voice start cancelled.");
      const answer = new Promise<string>((resolve, reject) => {
        this.#cancelNegotiation = () => {
          cleanup();
          reject(new Error("Voice start cancelled."));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Codex WebRTC negotiation timed out."));
        }, 30_000);
        const listener = (event: { method: string; params?: unknown }) => {
          if (!isRecord(event.params) || event.params.threadId !== threadId) return;
          if (event.method === "thread/realtime/sdp" && typeof event.params.sdp === "string") {
            cleanup();
            resolve(event.params.sdp);
          }
          if (event.method === "thread/realtime/error" || event.method === "thread/realtime/closed") {
            cleanup();
            reject(new Error("Codex realtime failed or closed during negotiation."));
          }
        };
        const cleanup = () => {
          clearTimeout(timer);
          this.#cancelNegotiation = null;
          client?.removeListener("notification", listener);
        };
        if (!client) throw new Error("Voice client is unavailable");
        client.on("notification", listener);
      });
      // Observe a timeout/error even if the start RPC itself rejects first.
      void answer.catch(() => undefined);
      await client.request(
        "thread/realtime/start",
        { threadId, transport: { type: "webrtc", sdp } },
        decodeRecordResponse,
      );
      return { sdp: await answer };
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    } finally {
      this.#starting = false;
    }
  }
  async stop(): Promise<void> {
    this.#generation++;
    this.#cancelNegotiation?.();
    const threadId = this.#thread;
    this.#thread = null;
    if (threadId && this.#client)
      await this.#client.request("thread/realtime/stop", { threadId }, decodeRecordResponse);
  }
  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.stop().catch(() => undefined);
    await this.#preparing?.catch(() => undefined);
    await this.#client?.stop();
    this.#client = null;
  }
}
