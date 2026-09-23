import type { ClientSideConnection, InitializeResponse } from "@agentclientprotocol/sdk";
import type { AgentHarnessId } from "@openbot/contracts/agent-harnesses";
import { type AgentProviderId, agentProviderName } from "@openbot/contracts/agent-providers";
import { AcpAgentClient } from "./acp-client";
import type { AgentCliInfo } from "./cli";
import { resolveHermesCli } from "./hermes-cli";
import { type BuiltInProviderDriver, type ProviderClientContext, requireProviderDriver } from "./provider-drivers";

/**
 * Layer 2 inside the Hermes harness. The Dani-Dex provider the user signed in to picks the
 * Hermes inference provider. Hermes adopts the Codex CLI and Claude Code sign-ins by default
 * (`auth.adopt_external_logins`), so a sign-in made in Dani-Dex carries straight into the harness.
 *
 * OpenCode differs from the native driver: Hermes removed the keyless free tier, so OpenCode
 * under Hermes needs the OpenCode Go key.
 */
export const HERMES_INFERENCE_PROVIDERS = {
  codex: "openai-codex",
  claude: "anthropic",
  grok: "xai-oauth",
  opencode: "opencode-go",
} as const satisfies Record<AgentProviderId, string>;

export interface HermesHarnessOptions {
  /** Dani-Dex's own Hermes state directory, so the harness never shares state with another app. */
  readonly hermesHome: string;
  /** A managed Hermes shipped with the app, or `null` to use only a user install. */
  readonly bundledExecutable?: string | null;
  /** Extra environment for tests and custom endpoints. Spread last. */
  readonly extraEnv?: () => Record<string, string>;
  /** Overrides the Layer 2 mapping, for custom OpenAI-compatible endpoints. */
  readonly inferenceProvider?: (provider: AgentProviderId) => string;
}

export function hermesEnvironment(
  provider: AgentProviderId,
  context: ProviderClientContext,
  options: HermesHarnessOptions,
): Record<string, string> {
  const opencodeKey = provider === "opencode" ? context.apiKey("opencode") : null;
  return {
    HERMES_HOME: options.hermesHome,
    HERMES_INFERENCE_PROVIDER: options.inferenceProvider?.(provider) ?? HERMES_INFERENCE_PROVIDERS[provider],
    ...(opencodeKey ? { OPENCODE_GO_API_KEY: opencodeKey } : {}),
    ...(options.extraEnv?.() ?? {}),
  };
}

export function hermesSignInMessage(provider: AgentProviderId): string {
  return provider === "opencode"
    ? "Hermes needs an OpenCode Go key to use OpenCode. Add it in Settings."
    : `Connect ${agentProviderName(provider)} first. Hermes uses that sign-in.`;
}

/** Picks the Hermes auth method that names the configured provider, never the terminal setup. */
export async function authenticateHermes(
  connection: ClientSideConnection,
  initialization: InitializeResponse,
  signInMessage: string,
): Promise<void> {
  const runtime = (initialization.authMethods ?? []).find((method) => method.id !== "hermes-setup");
  if (!runtime) throw new Error(`Hermes found no credentials. ${signInMessage}`);
  await connection.authenticate({ methodId: runtime.id });
}

export function createHermesClient(
  provider: AgentProviderId,
  cli: AgentCliInfo,
  requestTimeoutMs: number,
  context: ProviderClientContext,
  options: HermesHarnessOptions,
  profileGeneration = false,
): AcpAgentClient {
  const signInMessage = hermesSignInMessage(provider);
  return new AcpAgentClient(cli, requestTimeoutMs, {
    provider,
    profileGeneration,
    argv: ["acp"],
    env: {},
    extraEnv: () => hermesEnvironment(provider, context, options),
    signInMessage,
    authenticate: (connection, initialization) => authenticateHermes(connection, initialization, signInMessage),
    servesModel: context.servesModel,
    mcpServers: profileGeneration ? () => [] : context.mcpServers,
    reportMcpDrops: context.reportMcpDrops,
    mcpToolRuntimes: context.mcpToolRuntimes,
    mcpAuthorization: context.mcpAuthorization,
  });
}

/**
 * The driver a provider runs under the Hermes harness: Hermes' ACP server spawns, the provider's
 * own identity and auth state stay as they were. Sign-in stays external here because the provider's
 * own CLI owns it; Hermes only adopts the result.
 */
export function hermesProviderDriver(provider: AgentProviderId, options: HermesHarnessOptions): BuiltInProviderDriver {
  const native = requireProviderDriver(provider);
  return {
    id: provider,
    signIn: { kind: "external" },
    resolveCli: () =>
      resolveHermesCli(options.bundledExecutable === undefined ? {} : { bundledExecutable: options.bundledExecutable }),
    createClient: (cli, timeout, context) => createHermesClient(provider, cli, timeout, context, options),
    createProfileClient: (cli, timeout, context) => createHermesClient(provider, cli, timeout, context, options, true),
    authState: native.authState,
    validateAccount: () => undefined,
  };
}

/** Layer 1: which loop runs every provider. `null` keeps each provider's own CLI. */
export function harnessDriverResolver(
  harness: AgentHarnessId | null,
  options: HermesHarnessOptions,
): (provider: AgentProviderId) => BuiltInProviderDriver {
  if (harness === null) return requireProviderDriver;
  if (harness === "omp") throw new Error("OMP is not available until its upstream runtime is selected and verified.");
  const drivers = new Map<AgentProviderId, BuiltInProviderDriver>();
  return (provider) => {
    let driver = drivers.get(provider);
    if (!driver) {
      driver = hermesProviderDriver(provider, options);
      drivers.set(provider, driver);
    }
    return driver;
  };
}
