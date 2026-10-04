import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationContentValue,
  type InitializeResponse,
  ndJsonStream,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { agentProviderName } from "@dani-dex/contracts/agent-providers";
import { isFreeOpencodeModel } from "@dani-dex/contracts/ipc";
import { type DynamicRecord, isBoolean, isString } from "@dani-dex/contracts/runtime-values";
import { redactText } from "@dani-dex/logging";
import { elicitationOptions, elicitationValue, secretElicitationField } from "./agent/prompts";
import { fallbackFailure } from "./agent/worker-fallback";
import { historyData, transferableHistory, type WorkerHistory } from "./agent/worker-history";
import type { AgentProvider } from "./agent-client";
import { type AgentCliInfo, cliSpawnTarget } from "./cli";
import { type DynamicToolNamespace, LocalMcpBridge, type LocalMcpSession } from "./local-mcp-bridge";
import { prepareManagedOpenCodeEnvironment } from "./managed-opencode-environment";
import {
  acpMcpServers,
  type McpAuthorizationSource,
  type McpDropReporter,
  type McpServerSource,
  type McpToolRuntimeSource,
  usableMcpServers,
} from "./mcp-provider-shapes";
import {
  type AccountRateLimitsReadResult,
  type AppServerNotification,
  type AppServerRequest,
  type DynamicToolResult,
  getArray,
  getRecord,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type ThreadItem,
} from "./protocol";
import { createDiagnosticStream } from "./stderr-diagnostics";

/**
 * How long model discovery may spend on asking an agent for each model's reasoning efforts. One
 * OpenCode sweep of 49 models costs about 20ms, so this is not a target: it is the point where an
 * agent that answers slowly stops delaying the catalog the user is waiting for.
 */
const MODEL_REASONING_PROBE_BUDGET_MS = 5_000;

/**
 * How long one model's probe may take before the sweep goes on without it. An agent that stops
 * answering for one model then costs that model's efforts alone, and not the efforts of every model
 * after it in the catalog.
 */
const MODEL_REASONING_PROBE_TIMEOUT_MS = 1_000;

/**
 * What the sweep leaves of the discovery deadline for the two requests that follow it: the restore of
 * the model the session opened on, and the close of the probe session. Both are one round trip, and
 * the catalog the caller waits for is already built when they run.
 */
const MODEL_REASONING_CLEANUP_MS = 1_000;

/**
 * What discovery keeps of the caller's timeout to return with. Every request it makes ends by its own
 * deadline, which is this much before the timeout: a catalog that was read in time is worth returning,
 * and one that reaches the timeout is thrown away with the models already in it.
 */
const MODEL_DISCOVERY_RETURN_MS = 250;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface AcpTurn {
  id: string;
  itemId: string;
  thoughtItemId: string;
  text: string;
  thought: string;
  thoughtStarted: boolean;
  receivedOutput: boolean;
  messages: ThreadItem[];
  toolNames: Map<string, string>;
  toolOperations: Map<string, { operation: string | null; toolKind: string | null; displayTitle: string | null }>;
  task: Promise<void>;
  controller: AbortController;
  fallbackUsed: boolean;
}

interface AcpThread {
  id: string;
  wireId: string;
  resumed: boolean;
  retiredAttempt?: boolean;
  sessionArgs: {
    cwd: string;
    additionalDirectories: string[];
    mcpServers: Parameters<ClientSideConnection["newSession"]>[0]["mcpServers"];
  };
  cwd: string;
  developerInstructions: string;
  configOptions: SessionConfigOption[];
  currentModelId: string | null;
  mcp: LocalMcpSession;
  activeTurn: AcpTurn | null;
  turns: Array<{ id: string; status: string; items: ThreadItem[] }>;
}

interface AcpModel {
  id: string;
  name: string;
  description: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
  reasoningEffortWireValues: Map<string, string>;
  usesModelReasoningEffort: boolean | null;
}

interface AcpProviderAccount {
  email: string | null;
  planType: string | null;
}

export interface AcpProviderOptions {
  provider: AgentProvider;
  profileGeneration?: boolean;
  argv: readonly string[];
  env: Record<string, string>;
  /**
   * Variables read once per spawn rather than once per client, which is what lets a key saved after
   * construction reach the next process without any other plumbing. Spread after `env`.
   */
  extraEnv?: () => Record<string, string>;
  signInMessage: string;
  /**
   * Whether the model this turn runs on may still be used. Read here, after every wait this client
   * makes for the model configuration and the prompt images, because the endpoint can be removed
   * while those run and this process would still answer on it.
   */
  servesModel?(modelId: string): boolean;
  validateModel?(modelId: string, signal?: AbortSignal): Promise<void>;
  fallbackModel?: string;
  promptDeadlineMs?: number;
  workerHistory?: WorkerHistory;
  /** Drop the model's thought chunks: Dani's free models reason out loud, and it must not reach a bubble. */
  hideThoughtChunks?: boolean;
  /**
   * The user's own MCP servers, read at spawn. Dani-Dex's bridge servers are appended after these,
   * so a configuration can never displace the tools the agent depends on.
   */
  mcpServers?: McpServerSource;
  /** What this provider could not be given. Reported once per spawn, by `AgentService`. */
  reportMcpDrops?: McpDropReporter;
  mcpToolRuntimes?: McpToolRuntimeSource;
  mcpAuthorization?: McpAuthorizationSource;
  authenticate?(connection: ClientSideConnection, initialization: InitializeResponse): Promise<void>;
  /**
   * Reads optional identity fields that ACP does not define. A provider extension failing must not
   * turn a working authenticated process into a signed-out one, so account/read falls back to null
   * fields when this hook cannot answer.
   */
  readAccount?(connection: ClientSideConnection): Promise<Partial<AcpProviderAccount>>;
  readRateLimits?(connection: ClientSideConnection): Promise<AccountRateLimitsReadResult>;
}

export class AcpAgentClient extends EventEmitter<ClientEvents> {
  get provider(): AgentProvider {
    return this.options.provider;
  }
  readonly #pendingTurns = new Map<string, AbortController>();
  readonly #cli: AgentCliInfo;
  readonly #requestTimeoutMs: number;
  readonly #bridge = new LocalMcpBridge();
  readonly #threads = new Map<string, AcpThread>();
  readonly #startingThreads = new Map<string, Promise<{ thread: { id: string } }>>();
  readonly #pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  #process: ChildProcessWithoutNullStreams | null = null;
  #connection: ClientSideConnection | null = null;
  #initialized: Promise<void> | null = null;
  #initialization: InitializeResponse | null = null;
  #models: AcpModel[] = [];
  #signedIn = false;
  #stopping = false;

  constructor(
    cli: AgentCliInfo,
    requestTimeoutMs = 30_000,
    private readonly options: AcpProviderOptions,
  ) {
    super();
    this.#cli = cli;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null && !this.#stopping;
  }

  start(): void {
    if (this.running) return;
    this.#stopping = false;
    const target = cliSpawnTarget(this.#cli.executable, this.options.argv);
    const inheritedEnvironment = { ...process.env, ...this.options.env, ...this.options.extraEnv?.() };
    const environment =
      this.options.provider === "opencode" && this.#cli.source === "managed"
        ? prepareManagedOpenCodeEnvironment(inheritedEnvironment)
        : inheritedEnvironment;
    const child = spawn(target.command, target.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: environment,
      windowsVerbatimArguments: target.windowsVerbatimArguments,
      windowsHide: true,
    });
    this.#process = child;
    const stream = ndJsonStream(
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: Node and DOM declare the same Web Stream ABI with incompatible generic variance.
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );
    this.#connection = new ClientSideConnection(
      () => ({
        requestPermission: (params) => this.#requestPermission(params),
        sessionUpdate: (params) => this.#sessionUpdate(params),
        createElicitation: (params) => this.#createElicitation(params),
        extMethod: (method, params) => this.#requestUserInput(method, params),
      }),
      stream,
    );
    // One record at a time, never one chunk at a time: a chunk can end inside a JSON record, and a
    // record read in halves keeps the credential in its second half.
    const diagnostics = createDiagnosticStream({
      redact: redactText,
      emit: (message) => this.emit("diagnostic", message),
    });
    child.stderr.on("data", (chunk: Buffer) => diagnostics.push(chunk.toString("utf8")));
    child.once("close", () => diagnostics.flush());
    child.once("error", (error) => this.#fail(error, child));
    child.once("exit", (code, signal) => {
      const suffix = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.#fail(new Error(`ACP process exited with ${suffix}.`), child);
    });
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    for (const controller of this.#pendingTurns.values()) controller.abort();
    this.#pendingTurns.clear();
    const child = this.#process;
    this.#process = null;
    this.#connection = null;
    this.#initialized = null;
    for (const thread of this.#threads.values()) {
      thread.activeTurn?.controller.abort();
      thread.mcp.close();
    }
    this.#threads.clear();
    this.#startingThreads.clear();
    for (const pending of this.#pendingServerRequests.values()) pending.reject(new Error("ACP session stopped."));
    this.#pendingServerRequests.clear();
    await this.#bridge.close();
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(forceKill);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  /**
   * Closes one session and keeps the agent process for the other threads. The bridge session goes
   * first, because it is this app's own child; the agent is then told to drop the session, which is
   * what ends the MCP servers it started for it. An agent that does not answer `session/close` is
   * ignored: the session is already replaced on this side.
   */
  async releaseThread(sessionId: string): Promise<void> {
    const thread = this.#threads.get(sessionId);
    if (!thread) return;
    for (const [id, held] of this.#threads) if (held === thread) this.#threads.delete(id);
    thread.activeTurn?.controller.abort();
    thread.mcp.close();
    await this.#connection?.closeSession({ sessionId: thread.wireId }).catch(() => undefined);
  }

  async request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T> {
    if (!this.running) throw new Error("ACP client is not running.");
    switch (method) {
      case "initialize":
        await this.#ensureInitialized();
        return decoder({});
      case "account/read": {
        if (!this.#signedIn) return decoder({ account: null, requiresOpenaiAuth: false });
        const account = await this.#readProviderAccount(timeoutMs);
        return decoder({
          account: { type: this.provider, email: account.email, planType: account.planType },
          requiresOpenaiAuth: false,
        });
      }
      case "account/rateLimits/read":
        await this.#ensureInitialized();
        if (!this.#signedIn) return decoder({ rateLimits: null, rateLimitsByLimitId: null });
        return decoder(
          this.options.readRateLimits
            ? await withTimeout(
                this.options.readRateLimits(this.#requireConnection()),
                timeoutMs ?? this.#requestTimeoutMs,
                `${agentProviderName(this.provider)} request timed out: account/rateLimits/read`,
              )
            : { rateLimits: null, rateLimitsByLimitId: null },
        );
      case "model/list":
        await this.#ensureInitialized();
        if (this.#signedIn) this.#models = await this.#discoverModels(timeoutMs);
        return decoder({
          data: this.#models.map((model) => ({
            model: model.id,
            displayName: model.name,
            description: model.description,
            defaultReasoningEffort: model.defaultReasoningEffort,
            supportedReasoningEfforts: model.supportedReasoningEfforts.map((reasoningEffort) => ({ reasoningEffort })),
          })),
        });
      case "plugin/list":
        return decoder({ marketplaces: [] });
      case "thread/start":
        return decoder(await this.#startThread(params, false));
      case "thread/resume":
        return decoder(await this.#startThread(params, true));
      case "thread/read": {
        const thread = await this.#readableThread(requiredString(params, "threadId"), params);
        return decoder({
          thread: { id: thread?.id ?? requiredString(params, "threadId"), turns: thread?.turns ?? [] },
        });
      }
      case "turn/start":
        return decoder(await this.#startTurn(params, false));
      case "turn/steer":
        return decoder(await this.#startTurn(params, true));
      case "turn/interrupt": {
        const thread = this.#requireThread(requiredString(params, "threadId"));
        this.#pendingTurns.get(thread.id)?.abort();
        if (thread.activeTurn) {
          thread.retiredAttempt = true;
          try {
            this.options.workerHistory?.append(thread.id, {
              kind: "retirement",
              turnId: thread.activeTurn.id,
              reason: "user cancellation",
            });
          } catch (error) {
            this.emit(
              "diagnostic",
              redactText(`Retirement persistence failed; attempt remains quarantined: ${String(error)}`),
            );
          }
        }
        thread.activeTurn?.controller.abort();
        void this.#requireConnection()
          .cancel({ sessionId: thread.wireId })
          .catch((error) => this.emit("diagnostic", redactText(String(error))));
        return decoder({});
      }
      case "thread/compact/start":
        return decoder({});
      default:
        throw new Error(`ACP adapter does not implement ${method}.`);
    }
  }

  notify(): void {
    // ACP initialization is a request/response exchange without a follow-up notification.
  }

  respond(id: RequestId, result: unknown): void {
    const pending = this.#pendingServerRequests.get(id);
    if (!pending) return;
    this.#pendingServerRequests.delete(id);
    pending.resolve(result);
  }

  respondError(id: RequestId, error: RpcError): void {
    const pending = this.#pendingServerRequests.get(id);
    if (!pending) return;
    this.#pendingServerRequests.delete(id);
    pending.reject(new Error(error.message));
  }

  async #ensureInitialized(): Promise<void> {
    if (this.#initialized) return this.#initialized;
    this.#initialized = this.#initialize();
    return this.#initialized;
  }

  async #readProviderAccount(timeoutMs?: number): Promise<AcpProviderAccount> {
    if (!this.options.readAccount) return { email: null, planType: null };
    try {
      const account = await withTimeout(
        this.options.readAccount(this.#requireConnection()),
        timeoutMs ?? this.#requestTimeoutMs,
        `${agentProviderName(this.provider)} request timed out: account/read`,
      );
      return { email: account.email ?? null, planType: account.planType ?? null };
    } catch {
      return { email: null, planType: null };
    }
  }

  async #initialize(): Promise<void> {
    const connection = this.#requireConnection();
    this.#initialization = await withTimeout(
      connection.initialize({
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          elicitation: { form: {} },
          session: { configOptions: { boolean: {} } },
        },
        clientInfo: { name: "danidex", title: "Dani-Dex", version: "0.1.0" },
      }),
      this.#requestTimeoutMs,
      "ACP initialization timed out.",
    );
    try {
      await this.options.authenticate?.(connection, this.#initialization);
      // Disposable routing/profile clients use a model already validated by the main client.
      // Avoid a second full catalogue and per-model reasoning sweep before one read-only prompt.
      this.#models = this.options.profileGeneration ? [] : await this.#discoverModels();
      if (!this.options.profileGeneration && this.#models.length === 0) {
        throw new Error("ACP CLI did not advertise any ACP models. Dani-Dex will not guess a fallback model.");
      }
      this.#signedIn = true;
    } catch (error) {
      if (isAuthenticationError(error)) {
        this.#signedIn = false;
        return;
      }
      throw error;
    }
  }

  async #discoverModels(timeoutMs = this.#requestTimeoutMs): Promise<AcpModel[]> {
    const connection = this.#requireConnection();
    // One deadline for the whole discovery, read before the session opens and held short of the
    // caller's own timeout: what the sweep may spend is what a slow `session/new` left of the time
    // the caller gave `model/list`. A sweep that timed the caller out would return no catalog at all.
    const deadline = Date.now() + timeoutMs - MODEL_DISCOVERY_RETURN_MS;
    return withTimeout(
      (async () => {
        const probe = await connection.newSession({ cwd: process.cwd(), mcpServers: [] });
        try {
          return await this.#modelReasoningEfforts(connection, probe, modelsFromSessionSetup(probe), deadline);
        } finally {
          // Bounded like the probes, and for the same reason: the catalog is complete by now, and an
          // agent that is slow to close a session it is about to lose anyway must not take it away.
          await this.#requestBefore(
            () => connection.closeSession({ sessionId: probe.sessionId }),
            deadline,
            "session/close",
          );
        }
      })(),
      timeoutMs,
      `${agentProviderName(this.provider)} request timed out: model/list`,
    );
  }

  /**
   * A discovery request that gives up at `until`, and reports any failure as `null`.
   *
   * The request is sent here, and not by the caller: after `until` there is nothing to send. A
   * request made anyway would still reach the agent and still change the session the sweep is about
   * to give back, and its own failure would have nobody left to read it.
   */
  async #requestBefore<T>(request: () => Promise<T>, until: number, method: string): Promise<T | null> {
    const remaining = until - Date.now();
    if (remaining <= 0) return null;
    return withTimeout(request(), remaining, `${agentProviderName(this.provider)} request timed out: ${method}`).catch(
      () => null,
    );
  }

  /**
   * The reasoning efforts of each model, asked one model at a time on the session that listed them.
   *
   * An agent that holds reasoning in a session config option publishes `thought_level` for the model
   * the session is on, and a new session is on one model. Read as it arrives, every model of the
   * catalog carries that one model's efforts, and a model the session never selected carries no
   * efforts at all: OpenCode offers `minimal` to `xhigh` per model, and the Effort menu showed
   * `Medium` alone for all of them. Selecting the model on the same session makes the agent publish
   * the options of that model, so the catalog is built from one answer per model.
   *
   * Only for a catalog that came from the config option. An agent that describes each model's efforts
   * in `session/new` has answered already and is not asked again.
   *
   * No probe has to succeed. A model whose probe fails, or that the time does not reach, keeps the
   * session-wide efforts the catalog held before. `deadline` is when the caller's own `model/list`
   * times out: a sweep that ran past it would leave the user with no models at all, rather than with
   * imprecise efforts.
   */
  async #modelReasoningEfforts(
    connection: ClientSideConnection,
    probe: SessionSetupResponse & { sessionId: string },
    models: AcpModel[],
    deadline: number,
  ): Promise<AcpModel[]> {
    const option = (probe.configOptions ?? []).find(
      (candidate): candidate is Extract<SessionConfigOption, { type: "select" }> =>
        candidate.category === "model" && candidate.type === "select",
    );
    if (!option || availableModels(probe).length > 0) return models;
    // The sweep, and each request in it, ends at whichever comes first: its own budget, or the point
    // where the caller's deadline still holds the cleanup. One agent that never answers then costs
    // its own model's efforts, and not the whole catalog.
    const sweepEnd = Math.min(Date.now() + MODEL_REASONING_PROBE_BUDGET_MS, deadline - MODEL_REASONING_CLEANUP_MS);
    const probed: AcpModel[] = [];
    let selected = option.currentValue;
    for (const model of models) {
      const response = await this.#requestBefore(
        () => connection.setSessionConfigOption({ sessionId: probe.sessionId, configId: option.id, value: model.id }),
        Math.min(sweepEnd, Date.now() + MODEL_REASONING_PROBE_TIMEOUT_MS),
        "session/set_config_option",
      );
      if (response) selected = model.id;
      probed.push(response ? { ...model, ...reasoningFromConfig(response.configOptions) } : model);
    }
    // Back to the model the session opened on. The session is closed next, but an agent that keeps a
    // "last used model" outside the session would otherwise remember the end of this sweep, and the
    // user's own next CLI session would start on a model they never chose. Half of the cleanup
    // reserve, so the close that follows keeps the other half.
    if (selected !== option.currentValue) {
      await this.#requestBefore(
        () =>
          connection.setSessionConfigOption({
            sessionId: probe.sessionId,
            configId: option.id,
            value: option.currentValue,
          }),
        Math.min(Date.now() + MODEL_REASONING_CLEANUP_MS / 2, deadline),
        "session/set_config_option",
      );
    }
    return probed;
  }

  /**
   * The thread a `thread/read` can answer from, loading the session when it is not held here.
   *
   * An ACP session lives in this process alone, so a restart leaves every persisted session id
   * unknown until something loads it. Boot recovery reads those ids before any turn does, and a
   * refusal there is reported to the user as a failed history backfill. The session is loaded
   * instead, which also leaves it warm for the first turn. `null` is answered when it cannot be
   * loaded - the agent does not support `session/load`, the caller sent no `cwd`, or the load
   * failed - because a read is advisory: its callers treat an absent turn as an unsettled one.
   */
  async #readableThread(id: string, params: unknown): Promise<AcpThread | null> {
    const held = this.#threads.get(id);
    if (held) return held;
    if (!getString(params, "cwd")) return null;
    try {
      await this.#ensureInitialized();
      if (!this.#loadsSessions) return null;
      await this.#startThread(params, true);
    } catch (error) {
      this.emit("diagnostic", redactText(`ACP session load for a read failed: ${String(error)}`));
      return null;
    }
    return this.#threads.get(id) ?? null;
  }

  /** Whether the agent answers `session/load`, which it advertises in its initialization. */
  get #loadsSessions(): boolean {
    return this.#initialization?.agentCapabilities?.loadSession === true;
  }

  async #startThread(params: unknown, resume: boolean): Promise<{ thread: { id: string } }> {
    await this.#ensureInitialized();
    if (!this.#signedIn) throw new Error(this.options.signInMessage);
    const requestedThreadId = getString(params, "threadId");
    if (!resume || !requestedThreadId) return this.#openThread(params, false);
    const held = this.#threads.get(requestedThreadId);
    // A thread this client already holds takes the caller's settings even though no session is
    // opened for them: the loader may have been a `thread/read`, which carries none of its own, and
    // the turn that follows must not run on the settings of whoever loaded the session first.
    if (held) {
      held.developerInstructions = getString(params, "developerInstructions") ?? held.developerInstructions;
      await this.#applyConfig(held, getString(params, "model"), getString(params, "effort"));
      return { thread: { id: requestedThreadId } };
    }
    // One load per session id, however many callers ask for it. Boot recovery reads a session while
    // the first drain resumes it, and two `session/load` calls would leave two threads and two MCP
    // bridge sessions under one id, of which only the last is reachable.
    const starting = this.#startingThreads.get(requestedThreadId);
    if (starting) return starting;
    const start = this.#openThread(params, true).finally(() => {
      this.#startingThreads.delete(requestedThreadId);
    });
    this.#startingThreads.set(requestedThreadId, start);
    return start;
  }

  async #openThread(params: unknown, resume: boolean): Promise<{ thread: { id: string } }> {
    const requestedThreadId = getString(params, "threadId");
    if (resume && requestedThreadId && !this.#loadsSessions) {
      // Reported as a missing session, which is what it is for the caller: the agent cannot give
      // this session back, so the recovery that replaces it runs now rather than after a protocol
      // error the user would have to read.
      throw new Error(`Unknown ACP session: ${requestedThreadId}`);
    }
    const cwd = requiredString(params, "cwd");
    const dynamicTools = getArray(params, "dynamicTools").filter(isDynamicToolNamespace);
    let threadRef: AcpThread | null = null;
    const mcp = await this.#bridge.createSession(
      requestedThreadId ?? randomUUID(),
      dynamicTools,
      () => threadRef?.activeTurn?.id ?? null,
      (call) => this.#callDynamicTool(call),
    );
    try {
      const connection = this.#requireConnection();
      const additionalDirectories = getArray(params, "runtimeWorkspaceRoots").filter(isString);
      let id: string;
      let configOptions: SessionConfigOption[];
      let currentModelId: string | null;
      // Dani-Dex's bridge servers last: all providers key MCP servers by name, so a user
      // configuration that reached one of those names would take the agent's own tools away.
      const handoff = acpMcpServers(
        await usableMcpServers(
          this.options.mcpServers?.() ?? [],
          this.options.mcpToolRuntimes?.(),
          this.options.mcpAuthorization,
        ),
      );
      this.options.reportMcpDrops?.(this.provider, handoff.dropped);
      const mcpServers = [...handoff.servers, ...mcp.servers];
      if (resume && requestedThreadId) {
        let response: Awaited<ReturnType<typeof connection.loadSession>>;
        try {
          response = await connection.loadSession({
            sessionId: requestedThreadId,
            cwd,
            additionalDirectories,
            mcpServers,
          });
        } catch (error) {
          this.emit("diagnostic", redactText(`ACP saved-session load failed: ${String(error)}`));
          throw new Error(
            "Saved provider session unavailable. Your conversation is preserved. Restore the provider data before continuing; no messages or tools were replayed.",
            { cause: error },
          );
        }
        id = requestedThreadId;
        configOptions = response.configOptions ?? [];
        currentModelId = currentModelFromSessionSetup(response);
      } else {
        const response = await connection.newSession({ cwd, additionalDirectories, mcpServers });
        id = response.sessionId;
        configOptions = response.configOptions ?? [];
        currentModelId = currentModelFromSessionSetup(response);
      }
      mcp.setThreadId(id);
      const thread: AcpThread = {
        id,
        wireId: id,
        sessionArgs: { cwd, additionalDirectories, mcpServers },
        resumed: resume,
        cwd,
        developerInstructions: getString(params, "developerInstructions") ?? "",
        configOptions,
        currentModelId,
        mcp,
        activeTurn: null,
        turns: [],
      };
      threadRef = thread;
      this.#threads.set(id, thread);
      await this.#applyConfig(thread, getString(params, "model"), getString(params, "effort"));

      return { thread: { id } };
    } catch (error) {
      mcp.close();
      throw error;
    }
  }

  async #applyConfig(thread: AcpThread, model: string | null, effort: string | null): Promise<void> {
    for (const [category, value] of [
      ["model", model],
      ["thought_level", effort],
    ] as const) {
      if (!value) continue;
      if (category === "thought_level" && thread.currentModelId) {
        const currentModel = this.#models.find((candidate) => candidate.id === thread.currentModelId);
        if (currentModel && currentModel.usesModelReasoningEffort !== null) {
          if (currentModel.usesModelReasoningEffort && currentModel.supportedReasoningEfforts.includes(value)) {
            await this.#requireConnection().request("session/set_model", {
              sessionId: thread.wireId,
              modelId: thread.currentModelId,
              _meta: { reasoningEffort: currentModel.reasoningEffortWireValues.get(value) ?? value },
            });
          }
          continue;
        }
      }
      const option = thread.configOptions.find(
        (candidate): candidate is Extract<SessionConfigOption, { type: "select" }> =>
          candidate.category === category && candidate.type === "select",
      );
      if (!option) {
        if (category === "model" && thread.currentModelId !== value) {
          await this.#requireConnection().request("session/set_model", {
            sessionId: thread.wireId,
            modelId: value,
          });
          thread.currentModelId = value;
        }
        continue;
      }
      // An effort travels by Dani-Dex's name, and the agent's own name for it is read from the option
      // this session published, not from the catalog: the session is the one that has to accept it.
      const values = selectValues(option);
      const wanted =
        category === "thought_level" ? reasoningEffortWireValues(values.map((entry) => entry.value)).get(value) : value;
      const selected = values.find((candidate) => candidate.value === wanted);
      if (!selected) continue;
      const response = await this.#requireConnection().setSessionConfigOption({
        sessionId: thread.wireId,
        configId: option.id,
        value: selected.value,
      });
      thread.configOptions = response.configOptions;
      if (category === "model") thread.currentModelId = selected.value;
    }
  }

  async #startTurn(
    params: unknown,
    steer: boolean,
  ): Promise<{ turn: { id: string; status: string }; turnId?: string }> {
    const thread = this.#requireThread(requiredString(params, "threadId"));
    const deliveryId = getString(params, "clientUserMessageId");
    const completed = deliveryId ? thread.turns.find((turn) => turn.id === deliveryId) : undefined;
    if (!steer && completed) return { turn: { id: completed.id, status: completed.status } };
    const persisted = this.options.workerHistory?.read(thread.id);
    const priorDelivery = deliveryId
      ? persisted?.find((entry) => entry.kind === "terminal" && entry.turnId === deliveryId)
      : undefined;
    if (!steer && priorDelivery?.kind === "terminal")
      return { turn: { id: priorDelivery.turnId, status: priorDelivery.status } };
    const resolved = new Set(persisted?.filter((entry) => entry.kind === "terminal").map((entry) => entry.turnId));
    const unresolved = persisted?.some(
      (entry) =>
        (entry.kind === "user" || entry.kind === "item") &&
        entry.turnId !== thread.activeTurn?.id &&
        !resolved.has(entry.turnId),
    );
    if (
      thread.retiredAttempt ||
      unresolved ||
      persisted?.some((entry) => entry.kind === "retirement" || (entry.kind === "terminal" && entry.retiredAttempt))
    )
      throw new Error("This provider attempt was quarantined. Safe recovery is required before a new turn.");
    if (!steer && thread.activeTurn) throw new Error("The ACP thread already has an active turn.");
    if (steer)
      throw new Error(
        "Steering is temporarily unavailable for ACP: start a new message after the current turn finishes.",
      );
    await this.#applyConfig(thread, getString(params, "model"), getString(params, "effort"));
    const activeTurn = thread.activeTurn;
    const turnId = steer && activeTurn ? activeTurn.id : (getString(params, "clientUserMessageId") ?? randomUUID());
    const blocks = await promptBlocks(params);
    if (!steer && !thread.resumed && thread.turns.length === 0)
      this.options.workerHistory?.append(thread.id, {
        kind: "coverage",
        turnId: "origin",
        version: 1,
        fromBeginning: true,
      });
    if (!steer) this.options.workerHistory?.append(thread.id, { kind: "user", turnId, input: structuredClone(blocks) });
    if (!steer && thread.developerInstructions) {
      blocks.unshift({
        type: "text",
        text: `<dani-dex-developer-instructions>\n${thread.developerInstructions}\n</dani-dex-developer-instructions>`,
      });
    }
    const controller = new AbortController();
    if (this.#pendingTurns.has(thread.id)) throw new Error("A turn is already preparing.");
    this.#pendingTurns.set(thread.id, controller);
    try {
      this.#requireServedModel(thread);
      if (thread.currentModelId) await this.options.validateModel?.(thread.currentModelId, controller.signal);
      this.emit("notification", {
        method: "danidex/modelAttempt",
        params: {
          threadId: thread.id,
          turnId,
          primaryModel: thread.currentModelId,
          state: "dispatching",
          at: new Date().toISOString(),
          outputBoundary: false,
        },
      });
      if (controller.signal.aborted || this.#stopping) throw new Error("Turn cancelled before dispatch.");
      this.#requireServedModel(thread);
    } catch (error) {
      if (!steer)
        this.options.workerHistory?.append(thread.id, {
          kind: "terminal",
          turnId,
          status: controller.signal.aborted ? "interrupted" : "failed",
        });
      throw error;
    } finally {
      this.#pendingTurns.delete(thread.id);
    }
    this.#requireServedModel(thread);
    if (!steer && thread.activeTurn) throw new Error("The ACP thread already has an active turn.");
    const turn: AcpTurn = {
      id: turnId,
      itemId: `${turnId}:assistant`,
      thoughtItemId: `${turnId}:thought`,
      text: "",
      thought: "",
      thoughtStarted: false,
      receivedOutput: false,
      messages: [],
      toolNames: new Map(),
      toolOperations: new Map(),
      task: Promise.resolve(),
      controller,
      fallbackUsed: false,
    };
    thread.activeTurn = turn;
    this.emit("notification", {
      method: "turn/started",
      params: { threadId: thread.id, turn: { id: turn.id, status: "inProgress" } },
    });
    turn.task = this.#consumePrompt(thread, turn, blocks);
    return { turn: { id: turn.id, status: "inProgress" } };
  }

  /** Refuses a prompt whose endpoint was taken out while this turn was prepared. */
  #requireServedModel(thread: AcpThread): void {
    const model = thread.currentModelId;
    if (!model || !this.options.servesModel) return;
    if (!this.options.servesModel(model)) {
      throw new Error("The endpoint this agent used was removed. Choose another model for it.");
    }
  }

  async #consumePrompt(thread: AcpThread, turn: AcpTurn, prompt: ContentBlock[]): Promise<void> {
    try {
      const wireId = thread.wireId;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;
      const stopped = new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          thread.retiredAttempt = true;
          let persistenceFailure = "";
          try {
            this.options.workerHistory?.append(thread.id, {
              kind: "retirement",
              turnId: turn.id,
              reason: "prompt deadline",
            });
          } catch (error) {
            persistenceFailure = ` Retirement persistence failed: ${String(error)}`;
            this.emit("diagnostic", redactText(persistenceFailure));
          }
          void this.#requireConnection()
            .cancel({ sessionId: wireId })
            .catch((error) => this.emit("diagnostic", redactText(String(error))));
          reject(
            new Error(
              "ACP prompt deadline expired. The old attempt was quarantined; cancellation does not prove tool termination. Fallback paused." +
                persistenceFailure,
            ),
          );
        }, this.options.promptDeadlineMs ?? 120_000);
        abortListener = () => {
          reject(new Error("Turn cancelled"));
        };
        turn.controller.signal.addEventListener("abort", abortListener, { once: true });
      });
      let response: Awaited<ReturnType<ClientSideConnection["prompt"]>>;
      try {
        response = await Promise.race([this.#requireConnection().prompt({ sessionId: wireId, prompt }), stopped]);
      } finally {
        if (deadline) clearTimeout(deadline);
        if (abortListener) turn.controller.signal.removeEventListener("abort", abortListener);
      }

      if (turn.controller.signal.aborted || thread.activeTurn !== turn || this.#stopping) {
        this.#completeTurn(thread, turn, "interrupted", null);
        return;
      }
      if (response.usage)
        this.emit("notification", {
          method: "danidex/usage",
          params: { threadId: thread.id, turnId: turn.id, usage: response.usage },
        });
      // OpenCode can swallow provider errors and report a successful, empty ACP turn.
      // Do not invent the upstream cause or report that turn as a successful reply.
      if (this.provider === "opencode" && response.stopReason === "end_turn" && !turn.receivedOutput) {
        this.#completeTurn(
          thread,
          turn,
          "failed",
          "OpenCode returned no response. Check the selected model's sign-in and billing in OpenCode, then retry or choose another model.",
        );
        return;
      }
      const status =
        response.stopReason === "cancelled"
          ? "interrupted"
          : response.stopReason === "end_turn"
            ? "completed"
            : "failed";

      this.#completeTurn(thread, turn, status, status === "failed" ? response.stopReason : null);
    } catch (error) {
      const failure = fallbackFailure(error);
      const primary = thread.currentModelId;
      let coverage: ReturnType<WorkerHistory["read"]>;
      try {
        coverage = this.options.workerHistory?.read(thread.id) ?? null;
      } catch (historyError) {
        this.#completeTurn(thread, turn, turn.controller.signal.aborted ? "interrupted" : "failed", historyError);
        return;
      }
      if (
        this.provider === "opencode" &&
        primary &&
        primary.startsWith("opencode/") &&
        isFreeOpencodeModel(primary, primary) &&
        this.options.fallbackModel &&
        this.options.validateModel &&
        failure &&
        ((thread.turns.length === 0 && !thread.resumed) ||
          !!coverage?.some((entry) => entry.kind === "coverage" && entry.version === 1 && entry.fromBeginning)) &&
        !thread.retiredAttempt &&
        !turn.fallbackUsed &&
        !turn.receivedOutput &&
        !turn.controller.signal.aborted &&
        thread.activeTurn === turn
      ) {
        turn.fallbackUsed = true;
        this.emit("notification", {
          method: "danidex/modelAttempt",
          params: {
            threadId: thread.id,
            turnId: turn.id,
            primaryModel: primary,
            fallbackModel: this.options.fallbackModel,
            error: redactText(String(error)),
            failure,
            at: new Date().toISOString(),
            outputBoundary: false,
            state: "switching",
          },
        });
        try {
          const history = this.options.workerHistory?.read(thread.id);
          if (history === null && (thread.resumed || thread.turns.length))
            throw new Error("Committed history unavailable. Fallback paused.");
          const transferred = history?.length ? transferableHistory(history, turn.id) : [];
          await this.options.validateModel?.(this.options.fallbackModel, turn.controller.signal);
          if (turn.controller.signal.aborted || thread.activeTurn !== turn || turn.receivedOutput)
            throw new Error("Fallback paused after cancellation or output boundary.");
          // A distinct ACP session makes late primary notifications unambiguously stale.
          const opened = await this.#requireConnection().newSession(thread.sessionArgs);
          if (turn.controller.signal.aborted || thread.activeTurn !== turn || turn.receivedOutput)
            throw new Error("Fallback paused after cancellation or output boundary.");
          const retiredWireId = thread.wireId;
          thread.wireId = opened.sessionId;
          thread.retiredAttempt = false;
          thread.configOptions = opened.configOptions ?? [];
          thread.currentModelId = currentModelFromSessionSetup(opened);
          this.#threads.set(thread.wireId, thread);
          thread.mcp.setThreadId(thread.id);
          this.emit("notification", {
            method: "danidex/sessionRerouted",
            params: {
              threadId: thread.id,
              externalSessionId: thread.wireId,
              model: this.options.fallbackModel,
              turnId: turn.id,
            },
          });
          if (retiredWireId !== thread.id) this.#threads.delete(retiredWireId);
          await this.#applyConfig(thread, this.options.fallbackModel, null);
          if (turn.controller.signal.aborted || thread.activeTurn !== turn || turn.receivedOutput)
            throw new Error("Fallback paused after cancellation or output boundary.");
          this.#requireServedModel(thread);
          this.emit("notification", {
            method: "model/rerouted",
            params: { threadId: thread.id, turnId: turn.id, fromModel: primary, toModel: thread.currentModelId },
          });
          if (turn.controller.signal.aborted || thread.activeTurn !== turn || this.#stopping || turn.receivedOutput)
            throw new Error("Turn cancelled or output boundary during history transfer.");
          await this.#consumePrompt(thread, turn, transferred.length ? [historyData(transferred), ...prompt] : prompt);
          return;
        } catch (fallbackError) {
          this.#completeTurn(thread, turn, turn.controller.signal.aborted ? "interrupted" : "failed", fallbackError);
          return;
        }
      }
      this.#completeTurn(thread, turn, turn.controller.signal.aborted ? "interrupted" : "failed", error);
    }
  }

  #sessionUpdate(notification: SessionNotification): void {
    const thread = this.#threads.get(notification.sessionId);
    if (!thread || thread.retiredAttempt || thread.wireId !== notification.sessionId) return;
    const turn = thread.activeTurn;
    const update = notification.update;
    if (!turn || turn.controller.signal.aborted) return;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      if (update.content.text) this.#completeThought(thread, turn);
      if (update.content.text.trim()) turn.receivedOutput = true;
      turn.text += update.content.text;
      return;
    }
    if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
      if (update.content.text) turn.receivedOutput = true;
      if (this.options.hideThoughtChunks) return;
      this.#completeMessage(thread, turn, "commentary");
      /* A delta carries no phase, so the item has to be opened as `commentary` first — otherwise the
         thought lands in an ordinary agentMessage and renders as a chat bubble. */
      if (!turn.thoughtStarted) {
        turn.thoughtStarted = true;
        this.emit("notification", {
          method: "item/started",
          params: {
            threadId: thread.id,
            turnId: turn.id,
            item: { id: turn.thoughtItemId, type: "agentMessage", phase: "commentary" },
          },
        });
      }
      turn.thought += update.content.text;
      this.emit("notification", {
        method: "item/agentMessage/delta",
        params: { threadId: thread.id, turnId: turn.id, itemId: turn.thoughtItemId, delta: update.content.text },
      });
      return;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      turn.receivedOutput = true;
      if (update.sessionUpdate === "tool_call") this.#completeMessage(thread, turn, "commentary");
      // ACP updates are partial; OpenCode omits the name when a tool finishes.
      const name = update.name ?? turn.toolNames.get(update.toolCallId) ?? update.title ?? "tool";
      turn.toolNames.set(update.toolCallId, name);
      const previousOperation = turn.toolOperations.get(update.toolCallId);
      const operation = {
        operation: update.name ?? previousOperation?.operation ?? null,
        toolKind: update.kind ?? previousOperation?.toolKind ?? null,
        displayTitle: update.title ?? previousOperation?.displayTitle ?? null,
      };
      turn.toolOperations.set(update.toolCallId, operation);
      const prior = turn.messages.find((item) => item.id === update.toolCallId);
      const committed = {
        ...prior,
        id: update.toolCallId,
        type: "toolCall",
        name,
        status: update.status ?? prior?.status,
        arguments: mergeToolData(prior?.arguments, update.rawInput),
        result: mergeToolData(prior?.result, update.rawOutput),
        content: update.content ?? prior?.content,
      } satisfies ThreadItem;
      if (prior) Object.assign(prior, committed);
      else turn.messages.push(committed);
      this.options.workerHistory?.append(thread.id, {
        kind: "item",
        turnId: turn.id,
        item: committed,
        effectCommitted: update.status === "completed",
        effectUnknown: update.status !== "completed",
        ...operation,
      });
      this.emit("notification", {
        method: update.status === "completed" || update.status === "failed" ? "item/completed" : "item/started",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          item: committed,
        },
      });
      return;
    }
    if (update.sessionUpdate === "plan") {
      const text = update.entries
        .map((entry) => `- [${entry.status === "completed" ? "x" : " "}] ${entry.content}`)
        .join("\n");
      this.emit("notification", {
        method: "item/completed",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          item: { id: `${turn.id}:plan`, type: "agentMessage", phase: "analysis", text },
        },
      });
    }
  }

  // ACP cannot identify final text while streaming. Buffer unclassified text privately,
  // publishing commentary at a later step boundary or an answer when the prompt finishes.
  #completeMessage(thread: AcpThread, turn: AcpTurn, phase: "commentary" | "final_answer"): void {
    if (!turn.text) return;
    const item = { id: turn.itemId, type: "agentMessage", phase, text: turn.text } satisfies ThreadItem;
    turn.messages.push(item);
    this.options.workerHistory?.append(thread.id, { kind: "item", turnId: turn.id, item, effectCommitted: false });
    this.emit("notification", { method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } });
    turn.text = "";
    turn.itemId = `${turn.id}:assistant:${turn.messages.length}`;
  }

  #completeThought(thread: AcpThread, turn: AcpTurn): void {
    if (!turn.thoughtStarted) return;
    const item = {
      id: turn.thoughtItemId,
      type: "agentMessage",
      phase: "commentary",
      text: turn.thought,
    } satisfies ThreadItem;
    turn.messages.push(item);
    this.emit("notification", { method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item } });
    turn.thought = "";
    turn.thoughtStarted = false;
    turn.thoughtItemId = `${turn.id}:thought:${turn.messages.length}`;
  }

  #completeTurn(thread: AcpThread, turn: AcpTurn, status: string, error: unknown): void {
    if (thread.activeTurn !== turn) return;
    this.emit("notification", {
      method: "danidex/modelAttempt",
      params: {
        threadId: thread.id,
        turnId: turn.id,
        servingModel: thread.currentModelId,
        fallbackUsed: turn.fallbackUsed,
        outcome: status,
        outputBoundary: turn.receivedOutput,
        at: new Date().toISOString(),
      },
    });
    this.#completeThought(thread, turn);
    this.#completeMessage(thread, turn, "final_answer");
    if (status === "failed" && error) {
      const detail = redactText(String(error));
      const message =
        this.provider === "opencode" &&
        /invalid api key|unauthori[sz]ed|token refresh failed|authentication failed/i.test(detail)
          ? `Dani rejected the selected model's credentials. Update or remove the model key in Settings, then retry or choose another model.\n${detail}`
          : detail;
      this.emit("notification", {
        method: "error",
        params: { threadId: thread.id, turnId: turn.id, message },
      });
    }
    this.options.workerHistory?.append(thread.id, {
      kind: "terminal",
      turnId: turn.id,
      status,
      retiredAttempt: thread.retiredAttempt === true,
    });
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: thread.id, turn: { id: turn.id, status } },
    });
    thread.turns.push({ id: turn.id, status, items: turn.messages });
    thread.activeTurn = null;
  }

  async #requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    if (this.options.profileGeneration) return { outcome: { outcome: "cancelled" } };
    const thread = this.#threads.get(params.sessionId);
    if (!thread || thread.retiredAttempt || thread.wireId !== params.sessionId)
      return { outcome: { outcome: "cancelled" } };
    if (thread.activeTurn) thread.activeTurn.receivedOutput = true;
    if (thread?.activeTurn?.controller.signal.aborted) return { outcome: { outcome: "cancelled" } };
    const activeTurn = thread?.activeTurn;
    if (!activeTurn || thread?.activeTurn !== activeTurn || activeTurn.controller.signal.aborted)
      return { outcome: { outcome: "cancelled" } };
    const turnId = activeTurn.id;
    const kind =
      params.toolCall.kind === "execute"
        ? "command"
        : ["edit", "delete", "move"].includes(params.toolCall.kind ?? "")
          ? "file-change"
          : "permissions";
    const rawInput = isRecord(params.toolCall.rawInput) ? params.toolCall.rawInput : {};
    const acpScope = {
      kind: params.toolCall.kind ?? null,
      name: params.toolCall.name ?? null,
      title: params.toolCall.title ?? null,
      locations: (params.toolCall.locations ?? []).map((location) => ({
        path: location.path,
        line: location.line ?? null,
      })),
      rawInput: params.toolCall.rawInput ?? null,
      options: params.options.map((option) => ({ kind: option.kind, name: option.name, optionId: option.optionId })),
    };
    this.emit("diagnostic", redactText(`ACP permission scope: ${JSON.stringify(acpScope)}`));
    const requestedPermissions = kind === "permissions" ? { [params.toolCall.kind ?? "file-system"]: true } : null;
    const result = await this.#callServerRequest(
      `item/${kind === "command" ? "commandExecution" : kind === "file-change" ? "fileChange" : "permissions"}/requestApproval`,
      {
        threadId: thread.id,
        turnId,
        command: params.toolCall.kind === "execute" ? printableInput(params.toolCall.rawInput) : null,
        reason: params.toolCall.title ?? null,
        permissions: requestedPermissions,
        acpOptions: params.options,
        acpToolCall: acpScope,
        acpExternalDirectory:
          this.provider === "opencode" &&
          params.toolCall.kind === "other" &&
          typeof rawInput.parentDir === "string" &&
          typeof rawInput.filepath === "string" &&
          params.toolCall.locations?.some((location) => location.path === rawInput.parentDir) &&
          params.options.some((option) => option.kind === "allow_once")
            ? rawInput.parentDir
            : null,
      },
    );
    if (
      thread?.activeTurn !== activeTurn ||
      thread.retiredAttempt ||
      thread.wireId !== params.sessionId ||
      activeTurn.controller.signal.aborted ||
      this.#stopping
    )
      return { outcome: { outcome: "cancelled" } };
    const accepted =
      isRecord(result) &&
      (result.decision === "accept" ||
        result.decision === "approved" ||
        (isRecord(result.permissions) && Object.keys(result.permissions).length > 0));
    if (!accepted)
      this.options.workerHistory?.append(thread.id, {
        kind: "item",
        turnId,
        item: {
          id: params.toolCall.toolCallId,
          type: "toolCall",
          name: params.toolCall.name ?? "tool",
          status: "failed",
          arguments: params.toolCall.rawInput,
        },
        operation: params.toolCall.name ?? null,
        toolKind: params.toolCall.kind ?? null,
        displayTitle: params.toolCall.title ?? null,
        effectCommitted: false,
        effectUnknown: false,
        permission: "denied",
      });
    const option = bestPermissionOption(params.options, accepted);
    return option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } };
  }

  async #requestUserInput(method: string, params: DynamicRecord): Promise<DynamicRecord> {
    const sessionId = getString(params, "sessionId");
    const thread = sessionId ? this.#threads.get(sessionId) : undefined;
    if (
      !thread ||
      thread.retiredAttempt ||
      thread.wireId !== sessionId ||
      !thread.activeTurn ||
      thread.activeTurn.controller.signal.aborted
    )
      throw new Error("No live attempt for user input.");
    const active = thread.activeTurn;
    const result = await this.#callServerRequest("item/tool/requestUserInput", {
      ...params,
      threadId: sessionId,
      turnId: thread?.activeTurn?.id ?? randomUUID(),
      sourceMethod: method,
    });
    if (
      thread.retiredAttempt ||
      thread.wireId !== sessionId ||
      thread.activeTurn !== active ||
      active.controller.signal.aborted
    )
      throw new Error("Attempt retired during user input.");
    return isRecord(result) ? result : {};
  }

  async #createElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    const sessionId = getString(params, "sessionId");
    const thread = sessionId ? this.#threads.get(sessionId) : undefined;
    if (
      !thread ||
      thread.retiredAttempt ||
      thread.wireId !== sessionId ||
      !thread.activeTurn ||
      thread.activeTurn.controller.signal.aborted
    )
      return { action: "cancel" };
    const schema = getRecord(params, "requestedSchema");
    const properties = getRecord(schema, "properties") ?? {};
    const questions = Object.entries(properties).flatMap(([id, rawProperty]) => {
      if (!isRecord(rawProperty)) return [];
      const property = rawProperty;
      return [
        {
          id,
          header: getString(property, "title") ?? id,
          question: getString(property, "description") ?? getString(params, "message") ?? "ACP needs more information.",
          isSecret: secretElicitationField(id, property),
          options: elicitationOptions(property),
        },
      ];
    });
    if (questions.length === 0) {
      questions.push({
        id: "response",
        header: "ACP",
        question: getString(params, "message") ?? "ACP needs confirmation.",
        isSecret: false,
        options: null,
      });
    }
    const result = await this.#requestUserInput("session/elicitation", { ...params, questions });
    const answers = isRecord(result.answers) ? result.answers : null;
    if (!answers) return { action: "decline" };
    const content: Record<string, ElicitationContentValue> = {};
    for (const [id, answerValue] of Object.entries(answers)) {
      const answer = isRecord(answerValue) ? getArray(answerValue, "answers").filter(isString) : [];
      if (answer.length === 0) continue;
      content[id] = elicitationValue(isRecord(properties[id]) ? properties[id] : undefined, answer);
    }
    return Object.keys(content).length > 0 ? { action: "accept", content } : { action: "decline" };
  }

  async #callDynamicTool(params: {
    threadId: string;
    turnId: string;
    callId: string;
    namespace: string;
    tool: string;
    arguments: unknown;
  }): Promise<DynamicToolResult> {
    const turn = this.#threads.get(params.threadId)?.activeTurn;
    if (!turn || turn.id !== params.turnId || this.#threads.get(params.threadId)?.retiredAttempt)
      throw new Error("No active attempt for tool dispatch.");
    turn.receivedOutput = true;
    if (turn.controller.signal.aborted) throw new Error("Turn cancelled before tool dispatch.");
    this.options.workerHistory?.append(params.threadId, {
      kind: "item",
      turnId: turn.id,
      item: {
        id: params.callId,
        type: "toolCall",
        name: params.namespace + "." + params.tool,
        arguments: params.arguments,
        status: "in_progress",
      },
      operation: params.namespace + "." + params.tool,
      effectCommitted: false,
      effectUnknown: true,
    });
    const result = await this.#callServerRequest("item/tool/call", params);
    if (!isDynamicToolResult(result)) throw new Error("Dani-Dex returned an invalid dynamic tool result.");
    this.options.workerHistory?.append(params.threadId, {
      kind: "item",
      turnId: turn.id,
      operation: params.namespace + "." + params.tool,
      item: {
        id: params.callId,
        type: "toolCall",
        name: params.namespace + "." + params.tool,
        arguments: params.arguments,
        result,
        status: result.success ? "completed" : "failed",
      },
      effectCommitted: result.success,
      effectUnknown: !result.success,
    });
    return result;
  }

  #callServerRequest(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#pendingServerRequests.set(id, { resolve, reject });
      this.emit("request", { id, method, params });
    });
  }

  #requireThread(id: string): AcpThread {
    const thread = this.#threads.get(id);
    if (!thread) throw new Error(`Unknown ACP session: ${id}`);
    return thread;
  }

  #requireConnection(): ClientSideConnection {
    if (!this.#connection) throw new Error("ACP connection is not running.");
    return this.#connection;
  }

  #fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#process !== child) return;
    this.#process = null;
    if (!this.#stopping) this.emit("exit", error);
  }
}

function isDynamicToolNamespace(value: unknown): value is DynamicToolNamespace {
  return (
    isRecord(value) &&
    value.type === "namespace" &&
    isString(value.name) &&
    Array.isArray(value.tools) &&
    value.tools.every(
      (tool) => isRecord(tool) && tool.type === "function" && isString(tool.name) && isRecord(tool.inputSchema),
    )
  );
}

interface SessionSetupResponse {
  configOptions?: SessionConfigOption[] | null;
  models?: unknown;
}

function modelsFromSessionSetup(response: SessionSetupResponse): AcpModel[] {
  const options = sessionConfigOptions(response);
  const discovered = availableModels(response);
  if (discovered.length === 0) return modelsFromConfig(options);
  const configReasoning = reasoningFromConfig(options);
  return discovered.map((model) => {
    const supportedReasoningEfforts = model.supportedReasoningEfforts ?? configReasoning.supportedReasoningEfforts;
    const reasoningEffortWireValues = model.reasoningEffortWireValues;
    const defaultReasoningEffort =
      model.defaultReasoningEffort && supportedReasoningEfforts.includes(model.defaultReasoningEffort)
        ? model.defaultReasoningEffort
        : supportedReasoningEfforts.includes(configReasoning.defaultReasoningEffort)
          ? configReasoning.defaultReasoningEffort
          : (supportedReasoningEfforts[0] ?? "medium");
    return {
      id: model.id,
      name: model.name,
      description: model.description ?? "Model discovered from ACP CLI through ACP.",
      defaultReasoningEffort,
      supportedReasoningEfforts,
      reasoningEffortWireValues:
        reasoningEffortWireValues && reasoningEffortWireValues.size > 0
          ? reasoningEffortWireValues
          : configReasoning.reasoningEffortWireValues,
      usesModelReasoningEffort: model.usesModelReasoningEffort,
    };
  });
}

function modelsFromConfig(options: SessionConfigOption[]): AcpModel[] {
  const model = options.find(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.category === "model" && option.type === "select",
  );
  if (!model) return [];
  const reasoning = reasoningFromConfig(options);
  return selectValues(model).map((option) => ({
    id: option.value,
    name: option.name,
    description: option.description ?? "Model discovered from ACP CLI through ACP.",
    ...reasoning,
    usesModelReasoningEffort: null,
  }));
}

function reasoningFromConfig(
  options: SessionConfigOption[],
): Pick<AcpModel, "defaultReasoningEffort" | "supportedReasoningEfforts" | "reasoningEffortWireValues"> {
  const thought = options.find((option) => option.category === "thought_level" && option.type === "select");
  const wireValues = reasoningEffortWireValues(
    thought && thought.type === "select" ? selectValues(thought).map((option) => option.value) : ["medium"],
  );
  const supported = [...wireValues.keys()];
  const currentEffort =
    thought && thought.type === "select" ? (normalizeEffort(thought.currentValue) ?? "medium") : "medium";
  return {
    defaultReasoningEffort: supported.includes(currentEffort) ? currentEffort : (supported[0] ?? "medium"),
    supportedReasoningEfforts: supported.length > 0 ? supported : ["medium"],
    reasoningEffortWireValues: wireValues.size > 0 ? wireValues : new Map([["medium", "medium"]]),
  };
}

function sessionConfigOptions(response: SessionSetupResponse): SessionConfigOption[] {
  return response.configOptions ?? [];
}

function currentModelFromSessionSetup(response: SessionSetupResponse): string | null {
  if (!isRecord(response.models)) return null;
  return isString(response.models.currentModelId) && response.models.currentModelId.trim()
    ? response.models.currentModelId.trim()
    : null;
}

function availableModels(response: SessionSetupResponse): Array<{
  id: string;
  name: string;
  description: string | null;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: string[] | null;
  reasoningEffortWireValues: Map<string, string> | null;
  usesModelReasoningEffort: boolean | null;
}> {
  if (!isRecord(response.models) || !Array.isArray(response.models.availableModels)) return [];
  const seen = new Set<string>();
  return response.models.availableModels.flatMap((value) => {
    if (!isRecord(value) || !isString(value.modelId) || !value.modelId.trim()) return [];
    const id = value.modelId.trim();
    if (seen.has(id)) return [];
    seen.add(id);
    const metadata = isRecord(value._meta) ? value._meta : null;
    const reasoningEffortValues = Array.isArray(metadata?.reasoningEfforts)
      ? metadata.reasoningEfforts.filter(isRecord).flatMap((effort) => (isString(effort.value) ? [effort.value] : []))
      : null;
    const wireValues = reasoningEffortValues ? reasoningEffortWireValues(reasoningEffortValues) : null;
    const supportedReasoningEfforts = wireValues ? [...wireValues.keys()] : null;
    const usesModelReasoningEffort =
      metadata?.supportsReasoningEffort === false
        ? false
        : metadata?.supportsReasoningEffort === true || (supportedReasoningEfforts?.length ?? 0) > 0
          ? true
          : null;
    return [
      {
        id,
        name: isString(value.name) && value.name.trim() ? value.name.trim() : id,
        description: isString(value.description) && value.description.trim() ? value.description.trim() : null,
        defaultReasoningEffort:
          metadata && isString(metadata.reasoningEffort) ? normalizeEffort(metadata.reasoningEffort) : null,
        supportedReasoningEfforts:
          metadata?.supportsReasoningEffort === false
            ? ["medium"]
            : supportedReasoningEfforts && supportedReasoningEfforts.length > 0
              ? supportedReasoningEfforts
              : null,
        reasoningEffortWireValues: wireValues,
        usesModelReasoningEffort,
      },
    ];
  });
}

function selectValues(option: Extract<SessionConfigOption, { type: "select" }>) {
  return option.options.flatMap((entry) => ("options" in entry ? entry.options : [entry]));
}

/**
 * What Dani-Dex's effort names are sent as, keyed by the Dani-Dex name.
 *
 * The exact name wins over an alias, whichever comes first. OpenCode offers
 * `["minimal", "low", "medium", "high", "xhigh"]`, where `minimal` also reads as low effort: first
 * value per key would make Dani-Dex's `low` send `minimal`, and a user who asks for low effort would
 * silently get the lowest one the model has. An alias is still kept for a key the agent has no exact
 * name for, which is how a model with `minimal` and no `low` stays reachable.
 */
function reasoningEffortWireValues(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeEffort(value);
    if (!normalized) continue;
    const held = result.get(normalized);
    // `value.toLowerCase()` and not the normalized form of it: an exact name is the agent's own
    // spelling of the key, and every key Dani-Dex has is one word.
    if (held === undefined || (held !== normalized && value.toLowerCase() === normalized)) {
      result.set(normalized, value);
    }
  }
  return result;
}

function normalizeEffort(value: string): string | null {
  const normalized = value.toLowerCase().replaceAll("-", "_");
  if (["low", "medium", "high", "xhigh", "max"].includes(normalized)) return normalized;
  if (["minimal", "none", "off"].includes(normalized)) return "low";
  if (["extra_high", "very_high"].includes(normalized)) return "xhigh";
  return null;
}

async function promptBlocks(params: unknown): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  for (const item of getArray(params, "input")) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && isString(item.text)) blocks.push({ type: "text", text: item.text });
    if (item.type === "mention" && isString(item.path)) {
      blocks.push({ type: "text", text: `Attached local file: ${item.path}` });
    }
    if (item.type === "localImage" && isString(item.path)) {
      const data = await readFile(item.path);
      blocks.push({ type: "image", data: data.toString("base64"), mimeType: imageMimeType(item.path), uri: item.path });
    }
  }
  return blocks;
}

function imageMimeType(path: string): "image/jpeg" | "image/webp" | "image/png" {
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  return "image/png";
}

function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}

function printableInput(value: unknown): string | null {
  if (isString(value)) return value;
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function bestPermissionOption(options: PermissionOption[], accepted: boolean): PermissionOption | null {
  const kinds = accepted ? ["allow_once"] : ["reject_once", "reject_always"];
  return kinds.flatMap((kind) => options.filter((option) => option.kind === kind))[0] ?? null;
}

function isDynamicToolResult(value: unknown): value is DynamicToolResult {
  return (
    isRecord(value) &&
    isBoolean(value.success) &&
    Array.isArray(value.contentItems) &&
    value.contentItems.every(
      (item) =>
        isRecord(item) &&
        ((item.type === "inputText" && isString(item.text)) || (item.type === "inputImage" && isString(item.imageUrl))),
    )
  );
}

function isAuthenticationError(error: unknown): boolean {
  // "No LLM provider configured" is Hermes finding no sign-in for the provider. Read as a failure it
  // reached the user with Hermes' own advice to run `hermes model` in a terminal; it is a sign-in.
  return /auth|login|credential|token|unauthori[sz]ed|api key|no llm provider configured/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Tool arguments/results originate in JSON-RPC, not arbitrary JavaScript values. */
type ToolData = string | number | boolean | null | ToolData[] | ToolDataObject;
interface ToolDataObject {
  [key: string]: ToolData;
}
function parseToolData(value: unknown): ToolData | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => parseToolData(item) ?? null);
  if (isRecord(value)) {
    const parsed: ToolDataObject = {};
    for (const [key, item] of Object.entries(value)) {
      const data = parseToolData(item);
      if (data !== undefined) parsed[key] = data;
    }
    return parsed;
  }
  throw new Error("ACP tool data must be JSON-compatible");
}
function mergeToolData(previous: unknown, next: unknown): ToolData | undefined {
  if (next === undefined || next === null) return parseToolData(previous);
  if (isRecord(previous) && isRecord(next)) {
    const merged = parseToolData(previous);
    if (!merged || typeof merged !== "object" || Array.isArray(merged)) throw new Error("Expected tool object");
    for (const [key, value] of Object.entries(next)) {
      const data = mergeToolData(previous[key], value);
      if (data !== undefined) merged[key] = data;
    }
    return merged;
  }
  return parseToolData(next);
}
