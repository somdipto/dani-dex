import { EventEmitter } from "node:events";
import type { AgentClient } from "../backend/agent-client";
import { CodexAppServerClient } from "../backend/app-server-client";
import type {
  AppServerNotification,
  AppServerRequest,
  RequestId,
  ResponseDecoder,
  RpcError,
} from "../backend/protocol";
import { listChatGptPlanModels } from "./chatgpt-plan-models";
import { chatGptPlanRuntime } from "./chatgpt-plan-runtime";
import type { ChatGptRegistration } from "./chatgpt-plan-store";

/** Uses the selected verified plan identity and live account catalog, not provider CLI login files. */
export class ChatGptPlanClient extends EventEmitter implements AgentClient {
  readonly provider = "codex" as const;
  readonly accountSpecificCatalog = true;
  #child: CodexAppServerClient | null = null;
  #preparing: Promise<void> | null = null;
  #registration: ChatGptRegistration | null = null;
  #stopped = true;
  constructor(
    private readonly executable: string,
    private readonly timeout: number,
    private readonly ready: () => Promise<ChatGptRegistration>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }
  get running(): boolean {
    return !this.#stopped && (this.#child?.running ?? true);
  }
  start(): void {
    this.#stopped = false;
  }
  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#preparing?.catch(() => undefined);
    await this.#child?.stop();
    this.#child = null;
  }
  async #prepare(): Promise<void> {
    if (this.#child) return;
    if (!this.#preparing)
      this.#preparing = (async () => {
        this.#registration = await this.ready();
        if (this.#stopped) throw new Error("ChatGPT client stopped.");
        const child = new CodexAppServerClient(
          this.executable,
          this.timeout,
          chatGptPlanRuntime(() => this.#registration),
        );
        for (const event of ["notification", "request", "diagnostic", "exit"] as const)
          child.on(event, (value: AppServerNotification | AppServerRequest | string | Error) =>
            this.emit(event, event === "diagnostic" ? "ChatGPT runtime diagnostic." : value),
          );
        this.#child = child;
        child.start();
      })().finally(() => {
        this.#preparing = null;
      });
    await this.#preparing;
  }
  async request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T> {
    await this.#prepare();
    if (method === "account/read")
      return decoder({
        account: { type: "chatgpt", email: this.#registration?.email ?? null },
        requiresOpenaiAuth: false,
      });
    if (method === "model/list") {
      if (!this.#registration) throw new Error("ChatGPT is not connected.");
      const models = await listChatGptPlanModels(this.#registration, this.fetchImpl);
      return decoder({
        data: models.map((model) => ({
          id: model.id,
          model: model.id,
          displayName: model.name,
          isDefault: model === models[0],
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
        })),
        nextCursor: null,
      });
    }
    if (method.startsWith("account/login")) throw new Error("Use Sign in with ChatGPT in Dani-Dex.");
    if (!this.#child) throw new Error("ChatGPT client is unavailable.");
    if (this.#registration && this.#registration.expiresAt <= Math.floor(Date.now() / 1000))
      throw new Error("ChatGPT connection needs renewal. Reconnect before continuing.");
    return this.#child.request(method, params, decoder, timeoutMs);
  }
  notify(method: string, params?: unknown): void {
    this.#child?.notify(method, params);
  }
  respond(id: RequestId, result: unknown): void {
    this.#child?.respond(id, result);
  }
  respondError(id: RequestId, error: RpcError): void {
    this.#child?.respondError(id, error);
  }
}
