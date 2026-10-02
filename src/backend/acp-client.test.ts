import { AcpAgentClient } from "./acp-client";
// @vitest-environment node

/*
 * The OpenCode driver's environment seam, through a real spawn.
 *
 * OpenCode's whole account is one variable: with `OPENCODE_API_KEY` the CLI lists the paid Go
 * catalog, without it the free one. Nothing else in Dani-Dex reads that variable, so this file spawns
 * a fake ACP agent that reports the environment it was given, and asserts what a user gets: free
 * models with no account, the paid list after a key is saved, and no forced sign-in in between.
 *
 * A custom endpoint travels the same way, on `OPENCODE_CONFIG_CONTENT`, so the same spawn record
 * answers what the CLI was told about the endpoints the user saved.
 */

import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "@dani-dex/contracts/ipc";
import { isDynamicRecord } from "@dani-dex/contracts/runtime-values";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerHistoryEntry } from "./agent/worker-history";
import type { AgentClient } from "./agent-client";
import type { OpencodeCliInfo } from "./cli";
import { setRuntimeModelSource } from "./model-source";
import type { CustomProviderConfig } from "./opencode-config";
import type { AppServerNotification, AppServerRequest } from "./protocol";
import {
  decodeAccountReadResult,
  decodeModelListResponse,
  decodeRecordResponse,
  decodeThreadResponse,
  getRecord,
  getString,
} from "./protocol";
import { requireProviderDriver } from "./provider-drivers";

const started: AgentClient[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((client) => client.stop().catch(() => undefined)));
  // The fake agent reads its behaviour from the environment, so a stub left in place would decide
  // the next test as well.
  vi.unstubAllEnvs();
  setRuntimeModelSource(null);
});

/** An ACP agent that answers `initialize` and `session/new`, and records the env it was spawned with. */
const FAKE_AGENT = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const envLog = process.env.DANI_DEX_FAKE_ACP_ENV_LOG;
if (envLog) {
  fs.appendFileSync(
    envLog,
    JSON.stringify({
      argv: process.argv.slice(2),
      apiKey: process.env.OPENCODE_API_KEY ?? null,
      disableAutoupdate: process.env.OPENCODE_DISABLE_AUTOUPDATE ?? null,
      configContent: process.env.OPENCODE_CONFIG_CONTENT ?? null,
    }) + NL,
  );
}
let buffer = "";
function observedLate() { if(process.env.DANI_DEX_FAKE_ACP_LATE_LOG) fs.appendFileSync(process.env.DANI_DEX_FAKE_ACP_LATE_LOG,"observed" + NL); }
// An agent of the second kind: no \`models\` in \`session/new\`, one \`model\` config option, and a
// \`thought_level\` option that exists only while the session is on a model that reasons. OpenCode
// works this way, and \`minimal\` next to \`low\` is its own naming.
const FAILING_MODEL = process.env.DANI_DEX_FAKE_ACP_CONFIG_FAIL ?? null;
const HANGING_MODEL = process.env.DANI_DEX_FAKE_ACP_CONFIG_HANG ?? null;
const CONFIG_MODELS = [
  ...(FAILING_MODEL ? [FAILING_MODEL] : []),
  "agent/thinker",
  ...(HANGING_MODEL ? [HANGING_MODEL] : []),
  "agent/plain",
];
const THOUGHT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "default"];
let pendingPrompt;
let sessionCount = 0;
let promptCount = 0;
let selected = CONFIG_MODELS[0];
const configOptions = () => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: selected,
    options: CONFIG_MODELS.map((value) => ({ value, name: value })),
  },
  ...(selected === "agent/thinker"
    ? [
        {
          id: "effort",
          name: "Effort",
          category: "thought_level",
          type: "select",
          currentValue: "minimal",
          options: THOUGHT_LEVELS.map((value) => ({ value, name: value })),
        },
      ]
    : []),
];
const write = (message) => process.stdout.write(JSON.stringify(message) + NL);
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf(NL);
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
    index = buffer.indexOf(NL);
  }
});
function handle(message) {
  if (typeof message.id !== "undefined" && !message.method && process.env.DANI_DEX_FAKE_ACP_APPROVAL === "1") {
    const allowed=message.result?.outcome?.outcome === "selected";
    const effectLog=process.env.DANI_DEX_FAKE_ACP_EFFECT_LOG;if(effectLog)fs.appendFileSync(effectLog,JSON.stringify({allowed})+NL);
    write({jsonrpc:"2.0",id:pendingPrompt.id,result:{stopReason:allowed?"end_turn":"cancelled"}});return;
  }
  if (typeof message.id === "undefined") return;
  if (message.method === "initialize") {
    const agentCapabilities = process.env.DANI_DEX_FAKE_ACP_LOAD_SESSION === "1" ? { loadSession: true } : {};
    write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities } });
    return;
  }
  if (message.method === "session/load") {
    const loadLog = process.env.DANI_DEX_FAKE_ACP_LOAD_LOG;
    if (loadLog) fs.appendFileSync(loadLog, JSON.stringify(message.params) + NL);
    write({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/prompt") {
    if(process.env.DANI_DEX_FAKE_ACP_APPROVAL === "1") {pendingPrompt=message;write({jsonrpc:"2.0",id:"approval-from-provider",method:"session/request_permission",params:{sessionId:message.params.sessionId,toolCall:{toolCallId:"write-approval",kind:"edit",title:"temp-write",status:"pending"},options:[{optionId:"once",name:"Allow once",kind:"allow_once"},{optionId:"reject",name:"Reject",kind:"reject_once"}]}});return;}

    if (process.env.DANI_DEX_FAKE_ACP_DELAY_SUCCESS === "1") {
      setTimeout(()=>{write({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"LATE SUCCESS"}}}});write({jsonrpc:"2.0",id:message.id,result:{stopReason:"end_turn"}});observedLate();},150);return;
    }
    const promptLog = process.env.DANI_DEX_FAKE_ACP_PROMPT_LOG;
    if (promptLog) fs.appendFileSync(promptLog, JSON.stringify(message.params) + NL);
    promptCount++;
    if(process.env.DANI_DEX_FAKE_ACP_MISSING_INPUT === "1")write({jsonrpc:"2.0",id:"missing-input",method:"_synthetic_input",params:{question:"unbound"}});
    if(process.env.DANI_DEX_FAKE_ACP_HANG_PRIMARY === "1"&&promptCount===1){
      if(process.env.DANI_DEX_FAKE_ACP_TIMEOUT_LATE === "1")setTimeout(()=>{
       write({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"LATE PRIMARY"}}}});
       write({jsonrpc:"2.0",id:"late-primary-permission",method:"session/request_permission",params:{sessionId:message.params.sessionId,toolCall:{toolCallId:"late-write",kind:"edit",title:"temp-write",status:"pending"},options:[{optionId:"once",name:"Allow once",kind:"allow_once"}]}});
      observedLate();},95);return;
    }
    const failure = process.env.DANI_DEX_FAKE_ACP_FAILURE;
    const boundary = process.env.DANI_DEX_FAKE_ACP_BOUNDARY;
    if (boundary === "text") write({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"partial"}}}});
    if (boundary === "tool") write({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"tool_call",toolCallId:"effect-1",title:"write",kind:"edit",status:"completed",rawInput:{path:"temp"},rawOutput:"written"}}});
    if (failure && (promptCount === 1 || process.env.DANI_DEX_FAKE_ACP_FALLBACK_FAIL === "1")) {
      write({jsonrpc:"2.0",id:message.id,error:{code:-32000,message:failure}});
      if(process.env.DANI_DEX_FAKE_ACP_LATE_PRIMARY === "1")setTimeout(()=>{write({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"STALE PRIMARY"}}}});observedLate();},50);
      return;
    }
    write({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"FALLBACK OK"}}}});
    write({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
    return;
  }
  if (message.method === "session/set_config_option") {
    const configLog = process.env.DANI_DEX_FAKE_ACP_CONFIG_LOG;
    if (configLog) fs.appendFileSync(configLog, JSON.stringify(message.params) + NL);
    // No answer at all, which is what a hung agent gives.
    if (message.params.value === HANGING_MODEL) return;
    if (message.params.value === FAILING_MODEL) {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Model unavailable." } });
      return;
    }
    if (message.params.configId === "model") selected = message.params.value;
    write({ jsonrpc: "2.0", id: message.id, result: { configOptions: configOptions() } });
    return;
  }
  if (message.method === "session/new") {
    sessionCount++;
    const sessionLog = process.env.DANI_DEX_FAKE_ACP_SESSION_LOG;
    if (sessionLog) fs.appendFileSync(sessionLog, JSON.stringify(message.params) + NL);
    if (process.env.DANI_DEX_FAKE_ACP_REJECT_KEY === "1") {
      write({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Invalid api key." } });
      return;
    }
    if (process.env.DANI_DEX_FAKE_ACP_CONFIG_MODELS === "1") {
      selected = CONFIG_MODELS[0];
      write({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-" + sessionCount, configOptions: configOptions() } });
      return;
    }
    if (process.env.DANI_DEX_FAKE_ACP_EMPTY_MODELS === "1") {
      write({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-" + sessionCount } });
      return;
    }
    const ids = process.env.OPENCODE_API_KEY
      ? ["opencode-go/go-one", "opencode-go/go-two", "opencode-go/go-three"]
      : ["opencode/big-pickle"];
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        sessionId: "session-" + sessionCount,
        models: { availableModels: ids.map((modelId) => ({ modelId, name: modelId })), currentModelId: ids[0] },
      },
    });
    return;
  }
  write({ jsonrpc: "2.0", id: message.id, result: {} });
}
`;

interface FakeOpencode {
  cli: OpencodeCliInfo;
  directory: string;
  envLog: string;
  promptLog: string;
  configLog: string;
  loadLog: string;
  readLoadedSessions: () => Promise<Array<{ sessionId: string; cwd: string }>>;
  readPrompts: () => Promise<string[]>;
  readConfigCalls: () => Promise<Array<{ configId: string; value: string }>>;
  readSpawnEnvironments: () => Promise<
    Array<{
      argv: string[];
      apiKey: string | null;
      disableAutoupdate: string | null;
      configContent: string | null;
    }>
  >;
}

async function createFakeOpencodeAgent(source?: "system" | "managed"): Promise<FakeOpencode> {
  const directory = await mkdtemp(join(tmpdir(), "dani-dex-acp-opencode-"));
  const executable = join(directory, "opencode");
  await writeFile(executable, FAKE_AGENT);
  await chmod(executable, 0o755);
  const envLog = join(directory, "spawn-env.ndjson");
  const promptLog = join(directory, "prompts.ndjson");
  const configLog = join(directory, "config-options.ndjson");
  const loadLog = join(directory, "loaded-sessions.ndjson");
  return {
    cli: { executable, version: "1.18.30", ...(source ? { source } : {}) },
    directory,
    envLog,
    promptLog,
    configLog,
    loadLog,
    readLoadedSessions: async () => {
      const source = await readFile(loadLog, "utf8").catch(() => "");
      return source
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    },
    readPrompts: async () => {
      const source = await readFile(promptLog, "utf8").catch(() => "");
      return source.split("\n").filter((line) => line.trim());
    },
    readConfigCalls: async () => {
      const source = await readFile(configLog, "utf8").catch(() => "");
      return source
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    },
    readSpawnEnvironments: async () => {
      const source = await readFile(envLog, "utf8").catch(() => "");
      return source
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    },
  };
}

function startOpencode(
  cli: OpencodeCliInfo,
  apiKey: () => string | null,
  envLog: string,
  options: {
    /** Read at every spawn, so a test can save an endpoint between two processes. */
    customProviders?: () => CustomProviderConfig[];
    /** The one-shot client that generates a profile, which must stay unable to act. */
    profile?: boolean;
    /** Read at every prompt, so a test can remove an endpoint while a turn is prepared. */
    servesModel?: (modelId: string) => boolean;
    validateModel?: (modelId: string, signal?: AbortSignal) => Promise<void>;
    fallbackModel?: string;
    promptDeadlineMs?: number;
    workerHistory?: import("./agent/worker-history").WorkerHistory;
    /** Read at every session, the same way the real source is. */
    mcpServers?: () => McpServerConfig[];
    /** The bearer token a signed-in http server is given, minted at the hand-off and never stored. */
    mcpAuthorization?: (config: McpServerConfig) => Promise<string | null>;
    /** How long one request may take, which is also the deadline model discovery works inside. */
    requestTimeoutMs?: number;
  } = {},
): AgentClient {
  vi.stubEnv("DANI_DEX_FAKE_ACP_ENV_LOG", envLog);
  const driver = requireProviderDriver("opencode");
  const context = {
    apiKey,
    customProviders: options.customProviders ?? (() => []),
    mcpServers: options.mcpServers ?? (() => []),
    mcpAuthorization: options.mcpAuthorization,
    servesModel: options.servesModel,
    validateModel: options.validateModel,
    fallbackModel: options.fallbackModel,
    workerHistory: options.workerHistory,
  };
  const timeoutMs = options.requestTimeoutMs ?? 10_000;
  const client = options.promptDeadlineMs
    ? new AcpAgentClient(cli, timeoutMs, {
        provider: "opencode",
        argv: ["acp"],
        env: {},
        signInMessage: "none",
        validateModel: options.validateModel,
        fallbackModel: options.fallbackModel,
        workerHistory: options.workerHistory,
        promptDeadlineMs: options.promptDeadlineMs,
      })
    : options.profile
      ? (driver.createProfileClient?.(cli, timeoutMs, context) ?? driver.createClient(cli, timeoutMs, context))
      : driver.createClient(cli, timeoutMs, context);
  started.push(client);
  client.start();
  return client;
}

function customProvider(): CustomProviderConfig {
  return {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "test-key",
    models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
    headers: [],
  };
}

describe("OpenCode ACP environment", () => {
  it("spawns the free tier without the key variable at all", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    await client.request("initialize", {}, decodeRecordResponse);

    // An empty `OPENCODE_API_KEY` is not the same as an absent one: the CLI reads it as an account
    // and lists nothing. A user with no account has to see the variable missing.
    const [environment] = await fake.readSpawnEnvironments();
    expect(environment).toEqual({ argv: ["acp"], apiKey: null, disableAutoupdate: null, configContent: null });
    const account = await client.request("account/read", { refreshToken: false }, decodeAccountReadResult);
    expect(account.account).not.toBeNull();
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data.map((model) => model.model)).toEqual(["opencode/big-pickle"]);
  });

  it("reads the key at every spawn, so a key saved later reaches the next process", async () => {
    const fake = await createFakeOpencodeAgent("system");
    let key: string | null = null;
    // One client across both spawns, which is what makes this about the spawn and not the client:
    // the key is read while the process is created, so the same client picks up a later save.
    const client = startOpencode(fake.cli, () => key, fake.envLog);
    await client.request("initialize", {}, decodeRecordResponse);
    await client.stop();

    key = "go-key-value";
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);

    const environments = await fake.readSpawnEnvironments();
    expect(environments.map((environment) => environment.apiKey)).toEqual([null, "go-key-value"]);
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data.map((model) => model.model)).toEqual([
      "opencode-go/go-one",
      "opencode-go/go-two",
      "opencode-go/go-three",
    ]);
  });

  it("stops a managed install from updating itself past the pin", async () => {
    const managed = await createFakeOpencodeAgent("managed");
    const client = startOpencode(managed.cli, () => null, managed.envLog);
    await client.request("initialize", {}, decodeRecordResponse);

    // `verifyInstalledRuntime` compares the reported version with the pin for exact equality, so a
    // CLI that self-updates would leave Dani-Dex re-downloading a runtime it already has.
    expect((await managed.readSpawnEnvironments())[0]?.disableAutoupdate).toBe("1");
  });

  it("leaves the CLI a user installed free to update itself", async () => {
    const system = await createFakeOpencodeAgent("system");
    const client = startOpencode(system.cli, () => null, system.envLog);
    await client.request("initialize", {}, decodeRecordResponse);

    expect((await system.readSpawnEnvironments())[0]?.disableAutoupdate).toBeNull();
  });

  it("reports no account when OpenCode rejects the key", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("DANI_DEX_FAKE_ACP_REJECT_KEY", "1");
    const client = startOpencode(fake.cli, () => "not-a-key", fake.envLog);

    await client.request("initialize", {}, decodeRecordResponse);

    // A rejected key has to read as "sign in again", not as a broken CLI: this null account is what
    // `provider-runtime` turns into `sign-in-required` with the provider's own message.
    const account = await client.request("account/read", { refreshToken: false }, decodeAccountReadResult);
    expect(account.account).toBeNull();
  });

  it("spawns the ACP process with the custom endpoints the user saved", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const client = startOpencode(fake.cli, () => null, fake.envLog, { customProviders: () => [customProvider()] });

    await client.request("initialize", {}, decodeRecordResponse);

    const [environment] = await fake.readSpawnEnvironments();
    expect(JSON.parse(environment?.configContent ?? "")).toEqual({
      provider: {
        "studio-local": {
          npm: "@ai-sdk/openai-compatible",
          name: "Studio Local",
          options: { baseURL: "http://127.0.0.1:11434/v1", apiKey: "test-key" },
          models: { "qwen3-coder:30b": { name: "Qwen3 Coder 30B" } },
        },
      },
    });
  });

  it("adds Dani Free to a fresh keyless OpenCode spawn without hiding other sign-in choices", async () => {
    const fake = await createFakeOpencodeAgent("system");
    setRuntimeModelSource({
      id: "dani",
      name: "Dani",
      baseUrl: "http://127.0.0.1:40000/v1",
      apiKey: "local-only",
      models: [{ id: "dani-free-auto", name: "Dani Free Auto" }],
    });
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    await client.request("initialize", {}, decodeRecordResponse);
    const [environment] = await fake.readSpawnEnvironments();
    expect(environment?.apiKey).toBeNull();
    const config = JSON.parse(environment?.configContent ?? "");
    expect(config.provider.dani).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "Dani",
      options: { baseURL: "http://127.0.0.1:40000/v1", apiKey: "local-only" },
      models: { "dani-free-auto": { name: "Dani Free Auto" } },
    });
  });

  it("reads the endpoints at every spawn, so one saved later reaches the next process", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const providers: CustomProviderConfig[] = [];
    // One `opencode acp` process serves the whole app, so a saved endpoint can only reach it through
    // a respawn of a client that was built long before the save.
    const client = startOpencode(fake.cli, () => null, fake.envLog, { customProviders: () => providers });
    await client.request("initialize", {}, decodeRecordResponse);
    await client.stop();

    providers.push(customProvider());
    client.start();
    await client.request("initialize", {}, decodeRecordResponse);

    const environments = await fake.readSpawnEnvironments();
    // No endpoint means no config layer at all: an empty layer is not the same as no layer.
    expect(environments[0]?.configContent).toBeNull();
    expect(environments[1]?.configContent).toContain("studio-local");
  });

  it("keeps the deny-all layer while a profile client carries an endpoint", async () => {
    // Profile generation must not let the model act. Both layers travel on one environment variable,
    // so a custom endpoint that replaced the layer rather than joining it would give a one-shot
    // prompt full permissions.
    const fake = await createFakeOpencodeAgent("system");
    const client = startOpencode(fake.cli, () => null, fake.envLog, {
      customProviders: () => [customProvider()],
      profile: true,
    });

    await client.request("initialize", {}, decodeRecordResponse);

    const config = JSON.parse((await fake.readSpawnEnvironments())[0]?.configContent ?? "");
    expect(config.permission).toEqual({ "*": "deny" });
    expect(Object.keys(config.provider)).toEqual(["studio-local"]);
  });

  it("refuses to start on an OpenCode that lists no model at all", async () => {
    const fake = await createFakeOpencodeAgent("managed");
    vi.stubEnv("DANI_DEX_FAKE_ACP_EMPTY_MODELS", "1");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    // Not an authentication failure, so it is not softened into "sign in": an empty catalog is a CLI
    // Dani-Dex cannot drive, and guessing a model id here would send every prompt to a model the CLI
    // rejects. The provider row reports it as a failed connection.
    await expect(client.request("initialize", {}, decodeRecordResponse)).rejects.toThrow(
      "ACP CLI did not advertise any ACP models. Dani-Dex will not guess a fallback model.",
    );
  });

  it("refuses the prompt when the endpoint was removed while the turn was prepared", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
    // The endpoint is still saved while the thread is opened, and gone when the prompt would leave.
    let served = true;
    const client = startOpencode(fake.cli, () => null, fake.envLog, { servesModel: () => served });
    await client.request("initialize", {}, decodeRecordResponse);
    const thread = await client.request(
      "thread/start",
      { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()] },
      decodeRecordResponse,
    );
    const threadId = isDynamicRecord(thread.thread) ? thread.thread.id : null;
    if (typeof threadId !== "string") throw new Error("The fake agent opened no thread.");

    served = false;
    await expect(
      client.request(
        "turn/start",
        { threadId, clientUserMessageId: "delivery-1", input: [{ type: "inputText", text: "Keep working" }] },
        decodeRecordResponse,
      ),
    ).rejects.toThrow("The endpoint this agent used was removed. Choose another model for it.");

    // Nothing reached the process, which still holds the session it opened on that endpoint.
    expect(await fake.readPrompts()).toEqual([]);
  });
});

describe("OpenCode ACP reasoning efforts", () => {
  it("reports the efforts of each model, not the efforts of the model the session opened on", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_LOG", fake.configLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    const models = await client.request("model/list", {}, decodeModelListResponse);

    // `thought_level` describes the model the session is on, and a new session is on one model. Read
    // without a probe per model, the whole catalog carried that one answer: the Effort menu offered
    // `Medium` alone for a model that reasons from minimal to xhigh.
    expect(
      models.data.map((model) => [
        model.model,
        model.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
      ]),
    ).toEqual([
      ["agent/thinker", ["low", "medium", "high", "xhigh"]],
      // A model the agent gives no `thought_level` for has one effort, which is what it had before.
      ["agent/plain", ["medium"]],
    ]);
    // The sweep ends on the model the session opened on. An agent that remembers a last used model
    // outside the session would otherwise start the user's own next session on `agent/plain`.
    expect((await fake.readConfigCalls()).at(-1)).toEqual({
      sessionId: expect.any(String),
      configId: "model",
      value: "agent/thinker",
    });
  });

  it("keeps reading the rest of the catalog when one model refuses to be selected", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_LOG", fake.configLog);
    // The session opens on this model, and the agent rejects every attempt to select it.
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_FAIL", "agent/broken");
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    const models = await client.request("model/list", {}, decodeModelListResponse);

    // A model an agent will not answer for keeps the efforts the session published, and costs the
    // models after it nothing: a catalog is what the user picks from, so one refusal must not empty it.
    expect(
      models.data.map((model) => [
        model.model,
        model.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
      ]),
    ).toEqual([
      ["agent/broken", ["medium"]],
      ["agent/thinker", ["low", "medium", "high", "xhigh"]],
      ["agent/plain", ["medium"]],
    ]);
  });

  it("returns the catalog when a model's probe never answers", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_LOG", fake.configLog);
    // The agent accepts the selection of this model and then says nothing more about it.
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_HANG", "agent/silent");
    const client = startOpencode(fake.cli, () => null, fake.envLog, { requestTimeoutMs: 4_000 });

    const models = await client.request("model/list", {}, decodeModelListResponse);

    // The sweep runs inside the caller's own timeout, so a probe that never answers has to end
    // before that timeout does. A sweep that waited for it would time `model/list` out, and the
    // user would have no models to pick from instead of one model with imprecise efforts.
    expect(
      models.data.map((model) => [
        model.model,
        model.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort),
      ]),
    ).toEqual([
      ["agent/thinker", ["low", "medium", "high", "xhigh"]],
      // What the session published, which is the efforts of the model it opened on.
      ["agent/silent", ["low", "medium", "high", "xhigh"]],
      // The model after the silent one keeps its own answer: one probe ends, not the sweep.
      ["agent/plain", ["medium"]],
    ]);
  });

  it("sends the agent's own low effort, not the lowest effort the model has", async () => {
    const fake = await createFakeOpencodeAgent("system");
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_MODELS", "1");
    vi.stubEnv("DANI_DEX_FAKE_ACP_CONFIG_LOG", fake.configLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    await client.request(
      "thread/start",
      { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()], model: "agent/thinker", effort: "low" },
      decodeRecordResponse,
    );

    // `minimal` also reads as low effort and comes first in the agent's list, so a first-match
    // mapping sent the model's lowest setting whenever the user asked for low.
    expect((await fake.readConfigCalls()).slice(-2)).toEqual([
      { sessionId: expect.any(String), configId: "model", value: "agent/thinker" },
      { sessionId: expect.any(String), configId: "effort", value: "low" },
    ]);
  });
});

describe("OpenCode ACP MCP servers", () => {
  it("sends the enabled servers as ACP name/value pairs", async () => {
    const fake = await createFakeOpencodeAgent("system");
    const sessionLog = join(tmpdir(), `dani-dex-acp-session-${Date.now()}.ndjson`);
    vi.stubEnv("DANI_DEX_FAKE_ACP_SESSION_LOG", sessionLog);
    const configs: McpServerConfig[] = [
      {
        id: "mcp-1",
        name: "Filesystem",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["ready"],
        env: [{ key: "TOKEN", value: "secret" }],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
      {
        id: "mcp-2",
        name: "Off",
        transport: "stdio",
        enabled: false,
        command: "/bin/echo",
        args: [],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
      {
        id: "mcp-3",
        name: "Database",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: ["--database", "./data.db"],
        env: [],
        envPassthrough: [],
        workingDirectory: tmpdir(),
        url: "",
        headers: [],
      },
    ];
    const client = startOpencode(fake.cli, () => null, fake.envLog, { mcpServers: () => configs });
    await client.request("initialize", {}, decodeRecordResponse);
    await client.request("thread/start", { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()] }, decodeRecordResponse);

    const logged = (await readFile(sessionLog, "utf8")).split("\n").filter((line) => line.trim());
    // The first session is the model probe the client opens in its own directory; the thread is the
    // last one.
    const params = JSON.parse(logged.at(-1) ?? "{}");
    // ACP takes an array whose env is `{ name, value }` pairs, not a record. The launch `PATH` is
    // in there as well, which `claude-client.test.ts` covers.
    expect(params.mcpServers[0]).toMatchObject({
      name: "Filesystem",
      command: "/bin/echo",
      args: ["ready"],
      env: expect.arrayContaining([{ name: "TOKEN", value: "secret" }]),
    });
    // A disabled server is not sent, and Dani-Dex's own bridge entries append after these, so a
    // user's server can never displace one. `Database` is not sent either: ACP carries no working
    // directory, and a server told to open `./data.db` somewhere else creates a second database
    // rather than reading the one the user named.
    expect(params.mcpServers.map((server: { name: string }) => server.name)).toEqual(["Filesystem"]);
  });
});

describe("OpenCode MCP sign-in", () => {
  it("gives the session the token Dani-Dex minted for an http server", async () => {
    const fake = await createFakeOpencodeAgent();
    const sessionLog = join(tmpdir(), `dani-dex-acp-signin-${Date.now()}.ndjson`);
    vi.stubEnv("DANI_DEX_FAKE_ACP_SESSION_LOG", sessionLog);
    const config: McpServerConfig = {
      id: "mcp-1",
      name: "Signed in",
      transport: "http",
      enabled: true,
      command: "",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: "https://mcp.example.com/mcp",
      headers: [],
    };
    const client = startOpencode(fake.cli, () => null, fake.envLog, {
      mcpServers: () => [config],
      mcpAuthorization: async () => "minted-access-token",
    });
    await client.request("initialize", {}, decodeRecordResponse);
    await client.request("thread/start", { cwd: tmpdir(), runtimeWorkspaceRoots: [tmpdir()] }, decodeRecordResponse);

    // The row holds no credential: a native sign-in keeps the token in Dani-Dex's own store, so the
    // only way OpenCode can reach the server is the header written here, at the hand-off.
    const logged = (await readFile(sessionLog, "utf8")).split("\n").filter((line) => line.trim());
    const params = JSON.parse(logged.at(-1) ?? "{}");
    expect(params.mcpServers).toEqual([
      {
        type: "http",
        name: "Signed in",
        url: "https://mcp.example.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer minted-access-token" }],
      },
    ]);
  });
});

describe("OpenCode ACP session loading", () => {
  it("answers a read for a session this process does not hold by loading it", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("DANI_DEX_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("DANI_DEX_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    // What boot recovery sends after a restart: a session id from the database that no turn has
    // resumed yet. Before the session is loaded the client holds nothing under that id.
    const response = await client.request(
      "thread/read",
      { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
      decodeThreadResponse,
    );

    expect(response.thread.id).toBe("ses_stored");
    expect(await fake.readLoadedSessions()).toMatchObject([{ sessionId: "ses_stored", cwd: fake.directory }]);
  });

  it("loads a session once when a read and a resume ask for it together", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("DANI_DEX_FAKE_ACP_LOAD_SESSION", "1");
    vi.stubEnv("DANI_DEX_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);
    // The startup race: the history read and the first drain reach the same stored session id in
    // the same tick. Two loads would leave two threads and two MCP bridge sessions under one id.
    await Promise.all([
      client.request(
        "thread/read",
        { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
        decodeThreadResponse,
      ),
      client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
    ]);

    expect(await fake.readLoadedSessions()).toHaveLength(1);
  });

  it("reports a session an agent cannot load as missing instead of asking for it", async () => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("DANI_DEX_FAKE_ACP_LOAD_LOG", fake.loadLog);
    const client = startOpencode(fake.cli, () => null, fake.envLog);

    // An agent that does not advertise `loadSession` cannot give the session back. The read answers
    // an empty thread, so a restart reports no failure to the user, and the resume fails as a
    // missing session, which is what starts the replacement.
    const read = await client.request(
      "thread/read",
      { threadId: "ses_stored", cwd: fake.directory, includeTurns: true },
      decodeThreadResponse,
    );
    expect(read.thread.turns).toEqual([]);
    await expect(
      client.request("thread/resume", { threadId: "ses_stored", cwd: fake.directory }, decodeRecordResponse),
    ).rejects.toThrow(/unknown acp session/i);
    expect(await fake.readLoadedSessions()).toEqual([]);
  });
});

it("validates the selected model before sending any prompt", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  const validateModel = vi.fn(async () => {
    throw new Error("Catalog revoked");
  });
  const client = startOpencode(fake.cli, () => null, fake.envLog, { validateModel });
  const opened = await client.request(
    "thread/start",
    { cwd: tmpdir(), model: "opencode/muse-spark-1.3-contributor-free" },
    decodeRecordResponse,
  );
  const threadId = requireThreadId(opened);
  await expect(
    client.request("turn/start", { threadId, input: [{ type: "text", text: "Synthetic" }] }, decodeRecordResponse),
  ).rejects.toThrow("Catalog revoked");
  expect(validateModel).toHaveBeenCalledOnce();
  expect(await readFile(fake.promptLog, "utf8").catch(() => "")).toBe("");
});

it.each([
  "403 Forbidden",
  "429 quota",
  "503 service unavailable",
  "upstream timed out",
  "OpenCode's free tier can only be used from within OpenCode",
  "FreeTierError",
  "504 Gateway Timeout",
  "500 Internal Server Error",
  "ECONNRESET",
])("fallback once on classified backend failure %s", async (failure) => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  vi.stubEnv("DANI_DEX_FAKE_ACP_FAILURE", failure);
  const validateModel = vi.fn(async () => {});
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    validateModel,
    fallbackModel: "dani-kilo-worker/stepfun/step-3.7-flash:free",
  });
  const opened = await client.request(
    "thread/start",
    { cwd: tmpdir(), model: "opencode/big-pickle" },
    decodeRecordResponse,
  );
  const threadId = requireThreadId(opened);
  const events: AppServerNotification[] = [];
  client.on("notification", (n) => events.push(n));
  await client.request(
    "turn/start",
    { threadId, clientUserMessageId: "same-delivery", input: [{ type: "text", text: "Synthetic" }] },
    decodeRecordResponse,
  );
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  expect(events.filter((e) => e.method === "turn/completed")).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({ turn: { id: "same-delivery", status: "completed" } }),
    }),
  ]);
  expect(
    events.filter(
      (e) => e.method === "item/completed" && getString(getRecord(e.params, "item"), "phase") === "final_answer",
    ),
  ).toHaveLength(1);
  expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(2);
  expect(validateModel).toHaveBeenCalledWith("dani-kilo-worker/stepfun/step-3.7-flash:free", expect.any(AbortSignal));
});
it.each(["text", "tool"])("never fallback after primary %s boundary", async (boundary) => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  vi.stubEnv("DANI_DEX_FAKE_ACP_FAILURE", "403 Forbidden");
  vi.stubEnv("DANI_DEX_FAKE_ACP_BOUNDARY", boundary);
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    fallbackModel: "dani-kilo-worker/stepfun/step-3.7-flash:free",
    validateModel: async () => {},
  });
  const opened = await client.request(
    "thread/start",
    { cwd: tmpdir(), model: "opencode/big-pickle" },
    decodeRecordResponse,
  );
  const events: AppServerNotification[] = [];
  client.on("notification", (n) => events.push(n));
  await client.request(
    "turn/start",
    { threadId: requireThreadId(opened), input: [{ type: "text", text: "Synthetic" }] },
    decodeRecordResponse,
  );
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  expect(completedStatus(events)).toBe("failed");
  expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(1);
  expect(events.some((e) => e.method === "model/rerouted")).toBe(false);
});
it("cancel during catalog validation sends no prompt", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  let validating = false;
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    validateModel: async (_id, signal) => {
      validating = true;
      if (!signal) throw new Error("Validation must receive cancellation signal");
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
    },
  });
  const opened = await client.request(
    "thread/start",
    { cwd: tmpdir(), model: "opencode/big-pickle" },
    decodeRecordResponse,
  );
  const threadId = requireThreadId(opened);
  const pending = client.request(
    "turn/start",
    { threadId, input: [{ type: "text", text: "Synthetic" }] },
    decodeRecordResponse,
  );
  const rejected = expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(validating).toBe(true));
  await client.request("turn/interrupt", { threadId }, decodeRecordResponse);
  await rejected;
  expect(await readFile(fake.promptLog, "utf8").catch(() => "")).toBe("");
});
it.each(["invalid prompt", "safety refusal", "cancelled", "permission denied by user"])(
  "does not fallback for %s",
  async (failure) => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
    vi.stubEnv("DANI_DEX_FAKE_ACP_FAILURE", failure);
    const client = startOpencode(fake.cli, () => null, fake.envLog, {
      fallbackModel: "dani-kilo-worker/stepfun/step-3.7-flash:free",
      validateModel: async () => {},
    });
    const opened = await client.request(
      "thread/start",
      { cwd: tmpdir(), model: "opencode/big-pickle" },
      decodeRecordResponse,
    );
    const events: AppServerNotification[] = [];
    client.on("notification", (n) => events.push(n));
    await client.request(
      "turn/start",
      { threadId: requireThreadId(opened), input: [{ type: "text", text: "Synthetic" }] },
      decodeRecordResponse,
    );
    await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
    expect(events.some((e) => e.method === "model/rerouted")).toBe(false);
    expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(1);
  },
);
it.each(["invalid catalog", "fallback failed", "cancel during switch"])(
  "fallback closes honestly: %s",
  async (mode) => {
    const fake = await createFakeOpencodeAgent();
    vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
    vi.stubEnv("DANI_DEX_FAKE_ACP_FAILURE", "403 Forbidden");
    if (mode === "fallback failed") vi.stubEnv("DANI_DEX_FAKE_ACP_FALLBACK_FAIL", "1");
    let switching = false;
    const client = startOpencode(fake.cli, () => null, fake.envLog, {
      fallbackModel: "dani-kilo-worker/stepfun/step-3.7-flash:free",
      validateModel: async (id, signal) => {
        if (!id.startsWith("dani-kilo-worker/")) return;
        switching = true;
        if (mode === "invalid catalog") throw Error("Paid or invalid catalog");
        if (mode === "cancel during switch") {
          if (!signal) throw new Error("Expected cancellation signal");
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        }
      },
    });
    const opened = await client.request(
      "thread/start",
      { cwd: tmpdir(), model: "opencode/big-pickle" },
      decodeRecordResponse,
    );
    const threadId = requireThreadId(opened);
    const events: AppServerNotification[] = [];
    client.on("notification", (n) => events.push(n));
    await client.request(
      "turn/start",
      { threadId, input: [{ type: "text", text: "Synthetic" }] },
      decodeRecordResponse,
    );
    if (mode === "cancel during switch") {
      await vi.waitFor(() => expect(switching).toBe(true));
      await client.request("turn/interrupt", { threadId }, decodeRecordResponse);
    }
    await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
    expect(events.filter((e) => e.method === "turn/completed")).toHaveLength(1);
    expect(completedStatus(events)).toBe(mode === "cancel during switch" ? "interrupted" : "failed");
    expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(
      mode === "fallback failed" ? 2 : 1,
    );
  },
);
it("duplicate delivery id never replays a completed ACP prompt", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  const client = startOpencode(fake.cli, () => null, fake.envLog);
  const opened = await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  const threadId = requireThreadId(opened);
  const events: AppServerNotification[] = [];
  client.on("notification", (n) => events.push(n));
  const input = { threadId, clientUserMessageId: "duplicate-delivery", input: [{ type: "text", text: "Synthetic" }] };
  await client.request("turn/start", input, decodeRecordResponse);
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  await client.request("turn/start", input, decodeRecordResponse);
  expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(1);
});

it("late primary notification cannot contaminate distinct fallback session", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_FAILURE", "403 Forbidden");
  vi.stubEnv("DANI_DEX_FAKE_ACP_LATE_PRIMARY", "1");
  const lateLog = join(fake.directory, "late.log");
  vi.stubEnv("DANI_DEX_FAKE_ACP_LATE_LOG", lateLog);
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    fallbackModel: "dani-kilo-worker/stepfun/step-3.7-flash:free",
    validateModel: async () => {},
  });
  const opened = await client.request(
    "thread/start",
    { cwd: tmpdir(), model: "opencode/big-pickle" },
    decodeRecordResponse,
  );
  const events: AppServerNotification[] = [];
  client.on("notification", (n) => events.push(n));
  await client.request(
    "turn/start",
    { threadId: requireThreadId(opened), input: [{ type: "text", text: "Synthetic" }] },
    decodeRecordResponse,
  );
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  await vi.waitFor(async () => expect(await readFile(lateLog, "utf8")).toContain("observed"));
  await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  expect(events.filter((e) => e.method === "turn/completed")).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain("STALE PRIMARY");
});
it.each(["cancel", "shutdown"])("late successful response after %s never completes cancelled work", async (action) => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_DELAY_SUCCESS", "1");
  const lateLog = join(fake.directory, "late.log");
  vi.stubEnv("DANI_DEX_FAKE_ACP_LATE_LOG", lateLog);
  const client = startOpencode(fake.cli, () => null, fake.envLog);
  const opened = await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  const threadId = requireThreadId(opened);
  const events: AppServerNotification[] = [];
  client.on("notification", (n) => events.push(n));
  await client.request("turn/start", { threadId, input: [{ type: "text", text: "Synthetic" }] }, decodeRecordResponse);
  if (action === "cancel") await client.request("turn/interrupt", { threadId }, decodeRecordResponse);
  else await client.stop();
  if (action === "cancel") {
    await vi.waitFor(async () => expect(await readFile(lateLog, "utf8")).toContain("observed"));
    await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  }
  expect(
    events.some(
      (e) => e.method === "turn/completed" && getString(getRecord(e.params, "turn"), "status") === "completed",
    ),
  ).toBe(false);
});

it("approval accepted after cancellation cannot dispatch effect", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_APPROVAL", "1");
  const effectLog = join(fake.directory, "effect.log");
  vi.stubEnv("DANI_DEX_FAKE_ACP_EFFECT_LOG", effectLog);
  const client = startOpencode(fake.cli, () => null, fake.envLog);
  let approval: AppServerRequest | undefined;
  const events: AppServerNotification[] = [];
  client.on("request", (r) => {
    approval = r;
  });
  client.on("notification", (n) => events.push(n));
  const opened = await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  const threadId = requireThreadId(opened);
  await client.request("turn/start", { threadId, input: [{ type: "text", text: "Synthetic" }] }, decodeRecordResponse);
  await vi.waitFor(() => expect(approval).toBeDefined());
  await client.request("turn/interrupt", { threadId }, decodeRecordResponse);
  if (!approval) throw new Error("No permission request received");
  client.respond(approval.id, { decision: "accept" });
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  expect(JSON.parse((await readFile(effectLog, "utf8")).trim()).allowed).toBe(false);
  expect(completedStatus(events)).toBe("interrupted");
});

it("no-response deadline quarantines primary and fails closed without proven termination", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_HANG_PRIMARY", "1");
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    promptDeadlineMs: 70,
    fallbackModel: "dani-kilo-worker/stepfun/step-3.7-flash:free",
    validateModel: async () => {},
  });
  const opened = await client.request(
    "thread/start",
    { cwd: tmpdir(), model: "opencode/big-pickle" },
    decodeRecordResponse,
  );
  const events: AppServerNotification[] = [];
  client.on("notification", (n) => events.push(n));
  await client.request(
    "turn/start",
    { threadId: requireThreadId(opened), input: [{ type: "text", text: "Synthetic" }] },
    decodeRecordResponse,
  );
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  expect(events.filter((e) => e.method === "turn/completed")).toHaveLength(1);
  expect(completedStatus(events)).toBe("failed");
  expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(1);
});
it("predispatch validation failure writes original input and a failed terminal", async () => {
  const fake = await createFakeOpencodeAgent();
  const entries: WorkerHistoryEntry[] = [];
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    workerHistory: { read: () => entries, append: (_id, e) => entries.push(e) },
    validateModel: async () => {
      throw new Error("revoked");
    },
  });
  const opened = await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  await expect(
    client.request(
      "turn/start",
      { threadId: requireThreadId(opened), input: [{ type: "text", text: "original" }] },
      decodeRecordResponse,
    ),
  ).rejects.toThrow("revoked");
  expect(entries.map((e) => e.kind)).toEqual(["coverage", "user", "terminal"]);
  const terminal = entries.at(-1);
  if (terminal?.kind !== "terminal") throw new Error("Expected terminal worker history");
  expect(terminal.status).toBe("failed");
});

it("cancel while reading transfer history never sends the fallback prompt", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_FAILURE", "403 Forbidden");
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  const entries: WorkerHistoryEntry[] = [];
  let reads = 0;
  let threadId = "";
  let client: AgentClient;
  client = startOpencode(fake.cli, () => null, fake.envLog, {
    fallbackModel: "dani-kilo-worker/stepfun/step-3.7-flash:free",
    validateModel: async () => {},
    workerHistory: {
      append: (_id, e) => entries.push(e),
      read: () => {
        if (++reads === 2) void client.request("turn/interrupt", { threadId }, decodeRecordResponse);
        return entries;
      },
    },
  });
  const opened = await client.request(
    "thread/start",
    { cwd: tmpdir(), model: "opencode/big-pickle" },
    decodeRecordResponse,
  );
  threadId = requireThreadId(opened);
  const events: AppServerNotification[] = [];
  client.on("notification", (n) => events.push(n));
  await client.request("turn/start", { threadId, input: [{ type: "text", text: "original" }] }, decodeRecordResponse);
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  expect(completedStatus(events)).toBe("interrupted");
  expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(1);
});
it("second fallback failure is terminal and transferred history never becomes a recorded prompt", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_FAILURE", "403 Forbidden");
  vi.stubEnv("DANI_DEX_FAKE_ACP_FALLBACK_FAIL", "1");
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  const entries: WorkerHistoryEntry[] = [];
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    fallbackModel: "dani-kilo-worker/stepfun/step-3.7-flash:free",
    validateModel: async () => {},
    workerHistory: { read: () => entries, append: (_id, e) => entries.push(e) },
  });
  const opened = await client.request(
    "thread/start",
    { cwd: tmpdir(), model: "opencode/big-pickle" },
    decodeRecordResponse,
  );
  const events: AppServerNotification[] = [];
  client.on("notification", (n) => events.push(n));
  await client.request(
    "turn/start",
    { threadId: requireThreadId(opened), input: [{ type: "text", text: "original" }] },
    decodeRecordResponse,
  );
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  expect(events.filter((e) => e.method === "turn/completed")).toHaveLength(1);
  expect(completedStatus(events)).toBe("failed");
  expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(2);
  expect(entries.filter((e) => e.kind === "user")).toHaveLength(1);
  expect(JSON.stringify(entries)).not.toContain("<committed_history>");
});

it("timeout quarantines late primary text and permissions without reaching fallback validation", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_HANG_PRIMARY", "1");
  vi.stubEnv("DANI_DEX_FAKE_ACP_TIMEOUT_LATE", "1");
  const lateLog = join(fake.directory, "late.log");
  vi.stubEnv("DANI_DEX_FAKE_ACP_LATE_LOG", lateLog);
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  let validating = false;
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    promptDeadlineMs: 60,
    fallbackModel: "dani-kilo-worker/stepfun/step-3.7-flash:free",
    validateModel: async (model) => {
      if (model.startsWith("dani-kilo")) {
        validating = true;
        await new Promise<void>(() => {});
      }
    },
  });
  const opened = await client.request(
    "thread/start",
    { cwd: tmpdir(), model: "opencode/big-pickle" },
    decodeRecordResponse,
  );
  const events: AppServerNotification[] = [];
  const approvals: AppServerRequest[] = [];
  client.on("notification", (n) => events.push(n));
  client.on("request", (r) => approvals.push(r));
  await client.request(
    "turn/start",
    { threadId: requireThreadId(opened), input: [{ type: "text", text: "original" }] },
    decodeRecordResponse,
  );
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  await vi.waitFor(async () => expect(await readFile(lateLog, "utf8")).toContain("observed"));
  await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  expect(JSON.stringify(events)).not.toContain("LATE PRIMARY");
  expect(approvals).toHaveLength(0);
  expect(validating).toBe(false);
  expect(completedStatus(events)).toBe("failed");
  expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(1);
});

it("timed-out delivery is idempotent and new or steered work cannot reuse its retired wire", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_HANG_PRIMARY", "1");
  vi.stubEnv("DANI_DEX_FAKE_ACP_PROMPT_LOG", fake.promptLog);
  const client = startOpencode(fake.cli, () => null, fake.envLog, { promptDeadlineMs: 60 });
  const opened = await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  const threadId = requireThreadId(opened);
  const events: AppServerNotification[] = [];
  client.on("notification", (n) => events.push(n));
  const input = { threadId, clientUserMessageId: "deadline-delivery", input: [{ type: "text", text: "original" }] };
  await client.request("turn/start", input, decodeRecordResponse);
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  const duplicate = await client.request("turn/start", input, decodeRecordResponse);
  expect(getString(getRecord(duplicate, "turn"), "status")).toBe("failed");
  await expect(
    client.request("turn/start", { ...input, clientUserMessageId: "new-delivery" }, decodeRecordResponse),
  ).rejects.toThrow("Safe recovery");
  await expect(client.request("turn/steer", input, decodeRecordResponse)).rejects.toThrow("Safe recovery");
  expect((await readFile(fake.promptLog, "utf8")).trim().split("\n")).toHaveLength(1);
});

it.each(["retirement", "unresolved"])("persisted %s blocks a resumed attempt before prompt", async (mode) => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_LOAD_SESSION", "1");
  const entries: WorkerHistoryEntry[] = [
    { kind: "coverage", turnId: "origin", version: 1, fromBeginning: true },
    { kind: "user", turnId: "old", input: [{ type: "text", text: "old" }] },
  ];
  if (mode === "retirement") entries.push({ kind: "retirement", turnId: "old", reason: "deadline" });
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    workerHistory: { read: () => entries, append: (_id, e) => entries.push(e) },
  });
  const opened = await client.request(
    "thread/resume",
    { threadId: "persisted-wire", cwd: tmpdir() },
    decodeRecordResponse,
  );
  await expect(
    client.request(
      "turn/start",
      { threadId: requireThreadId(opened), clientUserMessageId: "new", input: [{ type: "text", text: "new" }] },
      decodeRecordResponse,
    ),
  ).rejects.toThrow("Safe recovery");
});
it("ACP steer fails closed before config or prompt until bounded safe dispatch exists", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_DELAY_SUCCESS", "1");
  const entries: WorkerHistoryEntry[] = [];
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    workerHistory: { read: () => entries, append: (_id, e) => entries.push(e) },
  });
  const opened = await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  const threadId = requireThreadId(opened);
  await client.request("turn/start", { threadId, input: [{ type: "text", text: "original" }] }, decodeRecordResponse);
  await expect(
    client.request("turn/steer", { threadId, input: [{ type: "text", text: "changed fact" }] }, decodeRecordResponse),
  ).rejects.toThrow("temporarily unavailable");
  expect(entries.filter((e) => e.kind === "steer")).toHaveLength(0);
});
it.each(["deadline", "interrupt"])("retirement append failure during %s still quarantines and closes", async (mode) => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_HANG_PRIMARY", "1");
  const entries: WorkerHistoryEntry[] = [];
  const client = startOpencode(fake.cli, () => null, fake.envLog, {
    promptDeadlineMs: mode === "deadline" ? 60 : 500,
    workerHistory: {
      read: () => entries,
      append: (_id, e) => {
        if (e.kind === "retirement") throw new Error("disk full");
        entries.push(e);
      },
    },
  });
  const opened = await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  const threadId = requireThreadId(opened);
  const events: AppServerNotification[] = [];
  const diagnostics: string[] = [];
  client.on("notification", (n) => events.push(n));
  client.on("diagnostic", (d) => diagnostics.push(d));
  await client.request("turn/start", { threadId, input: [{ type: "text", text: "original" }] }, decodeRecordResponse);
  if (mode === "interrupt") await client.request("turn/interrupt", { threadId }, decodeRecordResponse);
  await vi.waitFor(() => expect(events.some((e) => e.method === "turn/completed")).toBe(true));
  expect(diagnostics.join(" ")).toContain("persistence failed");
  await expect(
    client.request("turn/start", { threadId, input: [{ type: "text", text: "new" }] }, decodeRecordResponse),
  ).rejects.toThrow("Safe recovery");
  expect(entries.some((e) => e.kind === "retirement")).toBe(false);
});

it("unbound user input never picks another live session", async () => {
  const fake = await createFakeOpencodeAgent();
  vi.stubEnv("DANI_DEX_FAKE_ACP_HANG_PRIMARY", "1");
  vi.stubEnv("DANI_DEX_FAKE_ACP_MISSING_INPUT", "1");
  const client = startOpencode(fake.cli, () => null, fake.envLog, { promptDeadlineMs: 500 });
  const requests: AppServerRequest[] = [];
  const events: AppServerNotification[] = [];
  client.on("notification", (event) => {
    events.push(event);
  });
  client.on("request", (r) => requests.push(r));
  const first = await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  await client.request(
    "turn/start",
    { threadId: requireThreadId(first), input: [{ type: "text", text: "one" }] },
    decodeRecordResponse,
  );
  await client.request("turn/interrupt", { threadId: requireThreadId(first) }, decodeRecordResponse);
  const second = await client.request("thread/start", { cwd: tmpdir() }, decodeRecordResponse);
  await client.request(
    "turn/start",
    { threadId: requireThreadId(second), input: [{ type: "text", text: "two" }] },
    decodeRecordResponse,
  );
  await vi.waitFor(() => expect(events.some((event) => event.method === "turn/completed")).toBe(true));
  expect(requests).toHaveLength(0);
});

function requireThreadId(response: Parameters<typeof decodeRecordResponse>[0]): string {
  const id = getString(getRecord(response, "thread"), "id");
  if (!id) throw new Error("Fake provider did not return a thread ID");
  return id;
}
function completedStatus(events: AppServerNotification[]): string | null {
  const event = events.find((item) => item.method === "turn/completed");
  if (!event) throw new Error("No completed turn event received");
  return getString(getRecord(event.params, "turn"), "status");
}
