import { type AgentProviderId, type AgentStatus, agentProviderDescriptor } from "@dani-dex/contracts/ipc";
import { createEffect, createSignal, flush, onSettled } from "solid-js";
import { desktopAnalytics } from "./analytics";
import type { ProviderCodeLoginState } from "./components/ProviderCodeLoginDialog";
import type { ProviderCodeLoginApi } from "./components/provider-code-login-api";
import { toast } from "./components/ui";
import { useAgents } from "./features/agents/agents-context";
import { createProviderRuntimeStore } from "./features/provider-updates/provider-runtime-store";
import { useServers } from "./features/servers/servers-context";
import { createSimpleContext } from "./simple-context";

const Providers = createSimpleContext({
  name: "Providers",
  init: () => {
    const { agentStatus, setAgentStatus } = useAgents();
    const { activeServer } = useServers();
    const [apiKeyProvider, setApiKeyProvider] = createSignal<AgentProviderId | null>(null);
    const [chatGptConnecting, setChatGptConnecting] = createSignal(false);
    const [refreshingProviders, setRefreshingProviders] = createSignal(false);
    function systemCliVersion(provider: AgentProviderId): string | null {
      const row = agentStatus().providers?.find((candidate) => candidate.id === provider);
      return row?.cliSource === "system" ? (row.version ?? null) : null;
    }
    const runtimes = createProviderRuntimeStore(window.danidex.providerRuntimes, {
      systemCliVersion,
      isLocalServer: () => activeServer()?.kind === "local",
    });
    const pendingProviderConnections = new Map<AgentProviderId, ReturnType<typeof desktopAnalytics.scope>>();
    const [codeLoginProvider, setCodeLoginProvider] = createSignal<AgentProviderId | null>(null);
    const [codeLoginState, setCodeLoginState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
    let codeLoginExpiry: number | undefined;
    let codeLoginStarted = false;
    let codeLoginGeneration = 0;
    let codeLoginCancellation: Promise<void> = Promise.resolve();

    function applyAgentStatus(status: AgentStatus): void {
      for (const provider of status.providers ?? []) {
        const analytics = pendingProviderConnections.get(provider.id);
        if (!analytics) continue;
        if (provider.state === "available") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "succeeded",
          });
        } else if (provider.state === "error") {
          pendingProviderConnections.delete(provider.id);
          analytics.track("provider_action", {
            provider: provider.id,
            action: "connect_completed",
            result: "failed",
            failure_code: "connect_failed",
          });
        }
      }
      setAgentStatus(status);
    }

    function openProviderInstallGuide(provider: AgentProviderId): Promise<void> {
      const descriptor = agentProviderDescriptor(provider);
      if (descriptor.installGuideLink === null) {
        return Promise.reject(new Error(`${descriptor.displayName} is included with Dani-Dex.`));
      }
      return window.danidex.openExternal(descriptor.installGuideLink);
    }

    async function connectProvider(provider: AgentProviderId): Promise<void> {
      if (refreshingProviders()) return;
      if (provider === "claude")
        throw new Error(
          "Claude.ai subscription login in third-party apps requires Anthropic permission. Use the optional API key until this is approved.",
        );
      if (provider === "codex") setChatGptConnecting(true);
      const analytics = beginProviderConnection(provider);
      try {
        const status = await window.danidex.connectProvider(provider);
        flush(() => applyAgentStatus(status));
      } catch (error) {
        endFailedProviderConnection(provider, analytics);
        throw error;
      } finally {
        if (provider === "codex") setChatGptConnecting(false);
      }
    }

    function beginProviderConnection(provider: AgentProviderId) {
      const analytics = desktopAnalytics.scope();
      pendingProviderConnections.set(provider, analytics);
      analytics.track("provider_action", { provider, action: "connect_started", result: "succeeded" });
      return analytics;
    }

    function endFailedProviderConnection(
      provider: AgentProviderId,
      analytics: ReturnType<typeof desktopAnalytics.scope>,
    ): void {
      pendingProviderConnections.delete(provider);
      analytics.track("provider_action", {
        provider,
        action: "connect_completed",
        result: "failed",
        failure_code: "connect_failed",
      });
    }

    async function startProviderCodeLogin(provider: AgentProviderId): Promise<void> {
      const generation = ++codeLoginGeneration;
      clearCodeLoginExpiry();
      codeLoginStarted = false;
      setCodeLoginProvider(provider);
      setCodeLoginState({ phase: "starting" });
      const analytics = beginProviderConnection(provider);
      try {
        // Cancellation emits a terminal status. Finish it before the next attempt can wait.
        await codeLoginCancellation;
        if (generation !== codeLoginGeneration) return;
        const started = await window.danidex.startProviderCodeLogin(provider);
        // A dialog the user closed while the provider was answering: the login was cancelled with
        // it, so there is nobody left to show a code to.
        if (generation !== codeLoginGeneration) return;
        if (started.kind === "connected") {
          const row = agentStatus().providers?.find((candidate) => candidate.id === provider);
          endProviderCodeLogin(provider, { kind: "connected", accountLabel: row?.email ?? null });
          return;
        }
        flush(() =>
          setCodeLoginState({
            phase: "waiting",
            userCode: started.userCode,
            verificationUrl: started.verificationUrl,
            expiresAt: started.expiresAt,
          }),
        );
        // Main gives up on the same deadline and reports a failure, but the user is looking at a
        // countdown: when it reaches zero the screen has to say so without waiting for a round trip.
        codeLoginExpiry = window.setTimeout(
          () => {
            if (generation !== codeLoginGeneration) return;
            codeLoginExpiry = undefined;
            if (codeLoginState().phase === "waiting") endProviderCodeLogin(provider, { kind: "expired" });
          },
          Math.max(0, started.expiresAt - Date.now()),
        );
      } catch (error) {
        if (generation !== codeLoginGeneration) return;
        endFailedProviderConnection(provider, analytics);
        endProviderCodeLogin(provider, {
          kind: "failed",
          message:
            error instanceof Error && error.message
              ? error.message
              : `Dani-Dex could not connect ${agentProviderDescriptor(provider).displayName}. Try again.`,
        });
      }
    }

    function cancelProviderCodeLogin(): void {
      const provider = codeLoginProvider();
      const generation = ++codeLoginGeneration;
      codeLoginStarted = false;
      clearCodeLoginExpiry();
      setCodeLoginProvider(null);
      if (!provider) return;
      pendingProviderConnections.delete(provider);
      codeLoginCancellation = window.danidex
        .cancelProviderCodeLogin(provider)
        .then((status) => {
          if (generation === codeLoginGeneration) flush(() => applyAgentStatus(status));
        })
        // The provider has already stopped waiting for the code in every case that fails here: a
        // login that was never started, or one that ended on its own while the dialog was open.
        .catch(() => undefined);
    }

    function endProviderCodeLogin(
      provider: AgentProviderId,
      outcome:
        | { kind: "connected"; accountLabel: string | null }
        | { kind: "expired" }
        | { kind: "failed"; message: string },
    ): void {
      codeLoginGeneration++;
      clearCodeLoginExpiry();
      codeLoginStarted = false;
      flush(() => setCodeLoginProvider(null));
      const name = agentProviderDescriptor(provider).displayName;
      if (outcome.kind === "connected") {
        toast.success(`${name} connected`, {
          description: outcome.accountLabel
            ? `Signed in as ${outcome.accountLabel}.`
            : "The sign-in finished on the other device.",
        });
        return;
      }
      const retry = { label: "Get a new code", onClick: () => void startProviderCodeLogin(provider) };
      if (outcome.kind === "expired") {
        toast.warning(`The ${name} code expired`, {
          description: "Nobody entered it in time. That code no longer works.",
          action: retry,
        });
        return;
      }
      toast.error(`Could not connect ${name}`, {
        description: outcome.message,
        action: { ...retry, label: "Try again" },
      });
    }

    function clearCodeLoginExpiry(): void {
      if (codeLoginExpiry === undefined) return;
      window.clearTimeout(codeLoginExpiry);
      codeLoginExpiry = undefined;
    }

    createEffect(
      () => {
        const provider = codeLoginProvider();
        // The phase belongs in here rather than in the callback: a reactive read in an effect
        // callback is not tracked, so a dialog that reached `waiting` after the status did would
        // never be told about it.
        if (provider === null || codeLoginState().phase !== "waiting") return null;
        return agentStatus().providers?.find((row) => row.id === provider) ?? null;
      },
      (row) => {
        if (!row) return;
        if (row.connectionState === "connecting") {
          codeLoginStarted = true;
          return;
        }
        if (!codeLoginStarted) return;
        codeLoginStarted = false;
        if (row.state === "available" && !row.message) {
          endProviderCodeLogin(row.id, { kind: "connected", accountLabel: row.email ?? null });
        } else {
          endProviderCodeLogin(row.id, {
            kind: "failed",
            message:
              row.message ?? `Dani-Dex could not connect ${agentProviderDescriptor(row.id).displayName}. Try again.`,
          });
        }
      },
    );

    async function refreshAgentProviders(): Promise<void> {
      if (refreshingProviders() || agentStatus().phase === "starting" || agentStatus().phase === "restarting") {
        return;
      }
      const analytics = desktopAnalytics.scope();
      setRefreshingProviders(true);
      try {
        const status = await window.danidex.refreshAgentProviders();
        flush(() => applyAgentStatus(status));
        analytics.track("provider_action", { action: "refresh", result: "succeeded" });
      } catch (error) {
        analytics.track("provider_action", {
          action: "refresh",
          result: "failed",
          failure_code: "refresh_failed",
        });
        throw error;
      } finally {
        flush(() => setRefreshingProviders(false));
      }
    }

    onSettled(() => {
      return () => {
        codeLoginGeneration++;
        pendingProviderConnections.clear();
        clearCodeLoginExpiry();
      };
    });

    const codeLogin: ProviderCodeLoginApi = {
      provider: codeLoginProvider,
      state: codeLoginState,
      start: (provider) => void startProviderCodeLogin(provider),
      cancel: cancelProviderCodeLogin,
      openVerificationUrl: (url) => void window.danidex.openUrl(url),
    };

    return {
      ...runtimes,
      apiKeyProvider,
      openApiKey: (provider: AgentProviderId) => setApiKeyProvider(provider),
      closeApiKey: () => setApiKeyProvider(null),
      chatGptConnecting,
      cancelChatGpt: () => void window.danidex.chatGptPlan.cancel(),
      refreshingProviders,
      applyAgentStatus,
      connectProvider,
      codeLogin,
      openProviderInstallGuide,
      refreshAgentProviders,
    };
  },
});

export const ProvidersProvider = Providers.provider;
export const useProviders = Providers.use;
