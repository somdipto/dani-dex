import type { AgentAuthState, AgentProviderId } from "@dani-dex/contracts/ipc";
import { AcpAgentClient } from "./acp-client";
import type { WorkerHistory } from "./agent/worker-history";
import type { AgentClient } from "./agent-client";
import { CodexAppServerClient } from "./app-server-client";
import { ClaudeAgentClient } from "./claude-client";
import { type AgentCliInfo, resolveClaudeCli, resolveCodexCli, resolveGrokCli, resolveOpencodeCli } from "./cli";
import { GrokAgentClient } from "./grok-client";
import type { McpOAuthAuthority } from "./mcp-oauth-provider";
import type {
  McpAuthorizationSource,
  McpDropReporter,
  McpServerSource,
  McpToolRuntimeSource,
} from "./mcp-provider-shapes";
import { hasModelSource, withModelSource } from "./model-source";
import {
  type CustomProviderSource,
  OPENCODE_PROFILE_CONFIG,
  openCodeConfigEnv,
  openCodeSignInMessage,
} from "./opencode-config";
import type { AccountReadResult } from "./protocol";

export interface ProviderCliCommand {
  readonly argv: readonly string[];
  readonly env: (cli: AgentCliInfo) => Record<string, string>;
  readonly timeoutMs: number;
}

const CLI_LOGIN_TIMEOUT_MS = 10 * 60_000;

function opencodeEnv(cli: AgentCliInfo, credentials: ProviderClientContext): Record<string, string> {
  const key = credentials.apiKey("opencode");
  return {
    ...(key ? { OPENCODE_API_KEY: key } : {}),
    ...(cli.source === "managed" ? { OPENCODE_DISABLE_AUTOUPDATE: "1" } : {}),
  };
}

export type ProviderSignIn =
  | { kind: "browser" }
  | { kind: "cli-command"; command: ProviderCliCommand }
  | { kind: "external" };

export interface ProviderClientContext {
  apiKey(provider: AgentProviderId): string | null;
  readonly customProviders: CustomProviderSource;
  readonly mcpServers: McpServerSource;
  readonly reportMcpDrops?: McpDropReporter;
  readonly mcpToolRuntimes?: McpToolRuntimeSource;
  readonly mcpAuthorization?: McpAuthorizationSource;
  readonly mcpOAuth?: McpOAuthAuthority;
  servesModel?(modelId: string): boolean;
  validateModel?(modelId: string, signal?: AbortSignal): Promise<void>;
  fallbackModel?: string;
  workerHistory?: WorkerHistory;
}

export const NO_PROVIDER_CREDENTIALS: ProviderClientContext = {
  apiKey: () => null,
  customProviders: () => [],
  mcpServers: () => [],
};

export interface BuiltInProviderDriver {
  id: AgentProviderId;
  signIn: ProviderSignIn;
  resolveCli(options?: { bundledExecutable?: string | null }): Promise<AgentCliInfo>;
  createClient(cli: AgentCliInfo, requestTimeoutMs: number, context: ProviderClientContext): AgentClient;
  createProfileClient?(cli: AgentCliInfo, requestTimeoutMs: number, context: ProviderClientContext): AgentClient;
  authState(account: AccountReadResult["account"]): AgentAuthState;
  validateAccount(account: NonNullable<AccountReadResult["account"]>): void;
}

export const BUILT_IN_PROVIDER_DRIVERS: readonly BuiltInProviderDriver[] = [
  {
    id: "codex",
    signIn: { kind: "browser" },
    resolveCli: resolveCodexCli,
    createClient: (cli, requestTimeoutMs) => new CodexAppServerClient(cli.executable, requestTimeoutMs),
    authState: (account) => ({ kind: "chatgpt", email: account?.email ?? null }),
    validateAccount: (account) => {
      if (account.type !== "chatgpt") {
        throw new Error("Codex requires a ChatGPT subscription login. Run `codex login`.");
      }
    },
  },
  {
    id: "claude",
    signIn: {
      kind: "cli-command",
      command: {
        argv: ["auth", "login", "--claudeai"],
        env: (cli): Record<string, string> => (cli.source === "managed" ? { DISABLE_AUTOUPDATER: "1" } : {}),
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
      },
    },
    resolveCli: resolveClaudeCli,
    createClient: (cli, requestTimeoutMs, context) =>
      new ClaudeAgentClient(
        cli,
        undefined,
        undefined,
        requestTimeoutMs,
        context.mcpServers,
        context.reportMcpDrops,
        context.mcpToolRuntimes,
        context.mcpAuthorization,
        () => context.apiKey("claude"),
      ),
    authState: (account) => ({ kind: "claude", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "grok",
    signIn: {
      kind: "cli-command",
      command: {
        argv: ["--no-auto-update", "login"],
        env: () => ({ GROK_OAUTH2_REFERRER: "openbot" }),
        timeoutMs: CLI_LOGIN_TIMEOUT_MS,
      },
    },
    resolveCli: resolveGrokCli,
    createClient: (cli, requestTimeoutMs, context) =>
      new GrokAgentClient(
        cli,
        requestTimeoutMs,
        false,
        context.mcpServers,
        context.reportMcpDrops,
        context.mcpToolRuntimes,
        context.mcpAuthorization,
        context.apiKey("grok") ? () => context.apiKey("grok") : undefined,
      ),
    createProfileClient: (cli, requestTimeoutMs, context) =>
      new GrokAgentClient(
        cli,
        requestTimeoutMs,
        true,
        () => [],
        undefined,
        undefined,
        undefined,
        context.apiKey("grok") ? () => context.apiKey("grok") : undefined,
      ),
    authState: (account) => ({ kind: "grok", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "opencode",
    // `opencode auth login` is an interactive terminal UI and cannot be spawned headless, so the
    // optional OpenCode Go key is pasted into Dani-Dex instead. Nothing is required to sign in:
    // with no credential at all the CLI still lists the free models and answers a turn.
    signIn: { kind: "external" },
    resolveCli: resolveOpencodeCli,
    // Both clients read the key and the custom providers at spawn, and the profile client merges the
    // endpoints *into* the deny-all layer rather than beside it: the two share one environment
    // variable, so the layer would be lost if a custom provider config replaced it.
    createClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "opencode",
        argv: ["acp"],
        env: {},
        extraEnv: () => ({
          ...opencodeEnv(cli, context),
          ...openCodeConfigEnv(
            {},
            withModelSource(context.customProviders, () => context.apiKey("opencode")),
          ),
        }),
        signInMessage: openCodeSignInMessage(context.customProviders().length),
        hideThoughtChunks: hasModelSource(),
        servesModel: context.servesModel,
        validateModel: context.validateModel,
        fallbackModel: context.fallbackModel,
        workerHistory: context.workerHistory,
        mcpServers: context.mcpServers,
        reportMcpDrops: context.reportMcpDrops,
        mcpToolRuntimes: context.mcpToolRuntimes,
        mcpAuthorization: context.mcpAuthorization,
      }),
    createProfileClient: (cli, timeout, context) =>
      new AcpAgentClient(cli, timeout, {
        provider: "opencode",
        argv: ["acp"],
        profileGeneration: true,
        env: {},
        extraEnv: () => ({
          ...opencodeEnv(cli, context),
          ...openCodeConfigEnv(
            OPENCODE_PROFILE_CONFIG,
            withModelSource(context.customProviders, () => context.apiKey("opencode")),
          ),
        }),
        signInMessage: openCodeSignInMessage(context.customProviders().length),
        hideThoughtChunks: hasModelSource(),
        servesModel: context.servesModel,
        validateModel: context.validateModel,
        fallbackModel: context.fallbackModel,
      }),
    authState: (account) => ({ kind: "opencode", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
] as const;

export const PROVIDER_DRIVERS = new Map(BUILT_IN_PROVIDER_DRIVERS.map((driver) => [driver.id, driver]));

export function requireProviderDriver(provider: AgentProviderId): BuiltInProviderDriver {
  const driver = PROVIDER_DRIVERS.get(provider);
  if (!driver) throw new Error(`Unknown agent provider: ${provider}`);
  return driver;
}
