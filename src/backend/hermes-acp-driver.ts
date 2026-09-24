import type { ClientSideConnection, InitializeResponse } from "@agentclientprotocol/sdk";
import type { AgentHarnessId } from "@dani-dex/contracts/agent-harnesses";
import { type AgentProviderId, agentProviderName } from "@dani-dex/contracts/agent-providers";
import { DANI_DEX_MODEL_SOURCE, type DaniDexModelSource } from "@dani-dex/contracts/online-services";
import { AcpAgentClient } from "./acp-client";
import type { AgentCliInfo } from "./cli";
import { resolveHermesCli } from "./hermes-cli";
import { hasModelSource } from "./model-source";
import { type BuiltInProviderDriver, type ProviderClientContext, requireProviderDriver } from "./provider-drivers";

/**
 * Layer 2 inside the Hermes harness. The Dani-Dex provider the user signed in to picks the
 * Hermes inference provider. Hermes adopts the Claude Code sign-in; it does not adopt the Codex CLI
 * one, which is why `hermesServesProvider` keeps ChatGPT on its own CLI.
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
  // Users never meet the engine by name, so this speaks of the provider only.
  return provider === "opencode"
    ? "OpenCode needs an OpenCode Go key here. Add it in Settings."
    : `Sign in to ${agentProviderName(provider)} to continue.`;
}

/** Picks the Hermes auth method that names the configured provider, never the terminal setup. */
export async function authenticateHermes(
  connection: ClientSideConnection,
  initialization: InitializeResponse,
  signInMessage: string,
): Promise<void> {
  const runtime = (initialization.authMethods ?? []).find((method) => method.id !== "hermes-setup");
  if (!runtime) throw new Error(`No saved login found. ${signInMessage}`);
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

/**
 * Whether Hermes can run this provider on the sign-in the user already has, with nothing more to set
 * up. Checked against the pinned Hermes 0.19, not assumed:
 *
 * - Claude: Hermes reads Claude Code's own login (`~/.claude/.credentials.json`, or the macOS
 *   Keychain entry "Claude Code-credentials"), so a user signed in to Claude Code is signed in here.
 * - OpenCode: Hermes dropped the keyless free tier and needs an OpenCode Go key. Without one, the
 *   native OpenCode driver lists the free models with no account at all.
 * - ChatGPT (Codex): Hermes deliberately does not import `~/.codex/auth.json` (single-use refresh
 *   tokens would race the Codex CLI), so a Codex login never reached it and the provider showed no
 *   models. The native driver runs Codex on its own login.
 * - Grok: Hermes only knows its own `hermes model` OAuth, which a user cannot run from the app.
 *
 * A provider Hermes cannot serve this way runs on its own CLI. That is what "connects without any
 * issue" means for the user; the harness is still what runs every provider it can.
 */
export function hermesServesProvider(
  provider: AgentProviderId,
  apiKey: (provider: AgentProviderId) => string | null,
  modelSource: DaniDexModelSource | null = DANI_DEX_MODEL_SOURCE,
): boolean {
  if (provider === "claude") return true;
  // A configured model source is served by OpenCode itself (see `model-source.ts`), so the endpoint
  // is always the one in use.
  if (provider === "opencode") return !hasModelSource(modelSource) && Boolean(apiKey("opencode"));
  return false;
}

export interface HarnessResolverOptions extends HermesHarnessOptions {
  /** The stored provider keys, read on every resolve: saving an OpenCode Go key moves OpenCode to Hermes. */
  readonly apiKey?: (provider: AgentProviderId) => string | null;
}

/**
 * Layer 1: which loop runs each provider. `null` keeps each provider's own CLI. Under Hermes, a
 * provider Hermes cannot serve on the user's existing sign-in keeps its own CLI (see
 * `hermesServesProvider`). The answer is read on every call, because a provider re-resolves its
 * driver when its key changes.
 */
export function harnessDriverResolver(
  harness: AgentHarnessId | null,
  options: HarnessResolverOptions,
): (provider: AgentProviderId) => BuiltInProviderDriver {
  if (harness === null) return requireProviderDriver;
  if (harness === "omp") throw new Error("OMP is not available until its upstream runtime is selected and verified.");
  const apiKey = options.apiKey ?? (() => null);
  const drivers = new Map<AgentProviderId, BuiltInProviderDriver>();
  return (provider) => {
    if (!hermesServesProvider(provider, apiKey)) return requireProviderDriver(provider);
    let driver = drivers.get(provider);
    if (!driver) {
      driver = hermesProviderDriver(provider, options);
      drivers.set(provider, driver);
    }
    return driver;
  };
}
