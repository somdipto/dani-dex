import { AppLogo, ProviderLogo } from "@dani-dex/brand";
import { agentProviderDescriptor } from "@dani-dex/contracts/agent-providers";
import type {
  AgentProviderId,
  AgentProviderState,
  CustomProviderSummary,
  ProviderApiKeyStatus,
  ProviderRuntimePhase,
  ProviderRuntimeStatus,
} from "@dani-dex/contracts/ipc";
import type { AppMessages, AppTextKey, AppTranslate } from "@dani-dex/i18n";
import { createEffect, createUniqueId, For, Show } from "solid-js";
import { providerUpdateAvailable, providerVersionLabel } from "../features/provider-updates/provider-update";
import { useI18n } from "../i18n-context";
import { Badge, Button, Input, RefreshCw, SlidersHorizontal, Spinner } from "./ui";

export interface ProviderPickerOption {
  id: AgentProviderId;
  name: string;
  state: AgentProviderState;
  description?: string | null;
  message?: string | null;
  email?: string | null;
  connectionState?: "connecting";
  checkError?: string | null;
  runtimeStatus?: ProviderRuntimeStatus;
  keyStatus?: ProviderApiKeyStatus;
  availableVersion?: string | null;
}

export interface ProviderPickerProps {
  value: AgentProviderId | null;
  options: ProviderPickerOption[];
  ariaLabel: string;
  label?: string;
  hint?: string;
  embedded?: boolean;
  disabled?: boolean;
  daniOnly?: boolean;
  allowUnavailableSelection?: boolean;
  focusFirst?: boolean;
  refreshingProviders?: boolean;
  onOptionalApiKey?: (provider: AgentProviderId) => void;
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onDownloadProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onCancelProviderDownload?: (provider: AgentProviderId) => void | Promise<void>;
  onUpdateProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onInstallProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onSignInProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onSignInWithCodeProvider?: (provider: AgentProviderId) => void | Promise<void>;
  menuMount?: HTMLElement;
  onRefreshProviders?: () => void | Promise<void>;
  onAddCustomProvider?: () => void;
  customProviders?: readonly CustomProviderSummary[];
  customSelected?: boolean;
  onSelectCustomProvider?: () => void;
  onManageCustomProviders?: () => void;
  onChange: (provider: AgentProviderId) => void;
}

export function ProviderPicker(props: ProviderPickerProps) {
  const i18n = useI18n();
  const inputs = new Map<AgentProviderId, HTMLInputElement>();
  const pickerId = createUniqueId();
  const addCustomId = `${pickerId}-custom`;
  const customRadioId = `${pickerId}-custom-radio`;
  const openCode = () => props.options.find((option) => option.id === "opencode");
  // The free route leads the list; connected alternatives remain visible and selectable.
  const orderedOptions = () =>
    [...props.options].sort((a, b) => (a.id === "opencode" ? -1 : 0) - (b.id === "opencode" ? -1 : 0));
  const customReady = () => servesCustomProvider(openCode());
  const endpointCount = () => props.customProviders?.length ?? 0;
  const endpointCountLabel = () => i18n.t("provider.endpointCount", { count: endpointCount() });
  const countManageable = () => endpointCount() > 0 && Boolean(props.onManageCustomProviders);
  const customSelectable = () => Boolean(props.onSelectCustomProvider) && endpointCount() > 0;
  const checkedProvider = () => (customSelectable() && props.customSelected ? null : props.value);
  let focused = false;

  const customRow = (engine: () => ProviderPickerOption) => (
    <div
      class={[
        "provider-picker-option",
        "provider-picker-option-custom",
        {
          "provider-picker-option-selected": customSelectable() && Boolean(props.customSelected),
          "provider-picker-option-unavailable": !customReady(),
        },
      ]}
    >
      {/* Label targets radio when choosable, Add button otherwise. */}
      <label
        for={customSelectable() ? customRadioId : customReady() ? addCustomId : undefined}
        class="provider-picker-option-selection"
      >
        <Show when={customSelectable()}>
          <Input
            id={customRadioId}
            type="radio"
            name={props.ariaLabel}
            value="custom"
            checked={Boolean(props.customSelected)}
            disabled={props.disabled || (!props.allowUnavailableSelection && !customReady())}
            onChange={() => props.onSelectCustomProvider?.()}
          />
        </Show>
        <SlidersHorizontal class="provider-picker-custom-mark" aria-hidden="true" />
        <span class="provider-picker-identity">
          <span class="provider-picker-name">{i18n.t("provider.custom.name")}</span>
          <small class="provider-picker-email">{i18n.t("provider.custom.description")}</small>
        </span>
        <span class="provider-picker-state">
          {/* Count only; endpoint naming is the model picker's job. Moves beside Add when it opens the list. */}
          <Show when={endpointCount() > 0 && !countManageable()}>
            <Badge class="provider-picker-custom-count" tone="neutral" shape="pill">
              {endpointCountLabel()}
            </Badge>
          </Show>
          {/* Reports OpenCode state in shared words, without naming OpenCode. */}
          <Show when={!customReady()}>
            <Badge
              class={`provider-picker-status provider-picker-status-${engine().state}`}
              tone={providerStatusTone(engine().state)}
              shape="pill"
            >
              {providerStatusLabel(i18n.t, engine().state)}
            </Badge>
          </Show>
        </span>
      </label>
      <div class="provider-picker-actions">
        {/* Count as action: named for what it opens, not the state it shows. */}
        <Show when={countManageable()}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="provider-picker-custom-count"
            aria-label={i18n.t("provider.manageEndpoints", { count: endpointCount() })}
            disabled={props.disabled}
            onClick={() => props.onManageCustomProviders?.()}
          >
            {endpointCountLabel()}
          </Button>
        </Show>
        <Show when={customReady() && props.onAddCustomProvider}>
          <Button
            id={addCustomId}
            type="button"
            variant="outline"
            size="xs"
            class="provider-picker-install"
            aria-label={i18n.t("provider.custom.addLabel")}
            disabled={props.disabled || props.refreshingProviders}
            onClick={() => props.onAddCustomProvider?.()}
          >
            {i18n.t("provider.action.add")}
          </Button>
        </Show>
      </div>
    </div>
  );

  createEffect(
    () => ({
      focusFirst: props.focusFirst,
      options: orderedOptions(),
      allowUnavailableSelection: props.allowUnavailableSelection,
    }),
    ({ focusFirst, options, allowUnavailableSelection }) => {
      if (!focusFirst || focused) return;
      const first =
        options.find((option) => option.state === "available") ?? (allowUnavailableSelection ? options[0] : undefined);
      const input = first ? inputs.get(first.id) : undefined;
      if (!input) return;
      focused = true;
      input.focus();
    },
  );

  return (
    <div
      class={[
        "provider-picker",
        {
          "provider-picker-standalone": !props.embedded,
          "provider-picker-embedded": Boolean(props.embedded),
        },
      ]}
    >
      <Show when={props.label || props.onRefreshProviders}>
        <div class="provider-picker-heading">
          <Show when={props.label}>{(label) => <div class="provider-picker-label">{label()}</div>}</Show>
          <Show when={props.onRefreshProviders}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              class="provider-picker-refresh"
              aria-label={
                props.refreshingProviders ? i18n.t("provider.refreshingLabel") : i18n.t("provider.refreshLabel")
              }
              loading={props.refreshingProviders}
              loadingLabel={i18n.t("provider.refreshing")}
              disabled={props.disabled}
              onClick={() => void props.onRefreshProviders?.()}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {i18n.t("provider.refresh")}
            </Button>
          </Show>
        </div>
      </Show>
      <div class="provider-picker-list">
        {/* Custom row joins the group once endpoints exist. */}
        <div role="radiogroup" aria-label={props.ariaLabel}>
          <For each={orderedOptions()} keyed={false}>
            {(option) => {
              const state = () => option().state;
              const runtimeStatus = () => option().runtimeStatus;
              const connecting = () => option().connectionState === "connecting";
              const available = () => state() === "available";
              const updatable = () => {
                const runtime = runtimeStatus();
                return runtime ? providerUpdateAvailable(runtime, option().availableVersion ?? null) : false;
              };
              const version = () => {
                const runtime = runtimeStatus();
                return runtime ? providerVersionLabel(runtime) : null;
              };
              const visualState = () => providerVisualState(state(), connecting(), runtimeStatus(), updatable());
              const daniRow = () => option().id === "opencode";
              const runtimeAction = () =>
                option().id === "codex" &&
                !["not-downloaded", "download-error", "downloading", "finishing"].includes(runtimeStatus()?.phase ?? "")
                  ? undefined
                  : updatable() && props.onUpdateProvider && runtimeStatus()?.phase === "not-downloaded"
                    ? undefined
                    : providerRuntimeAction(state(), connecting(), runtimeStatus());
              const inputId = () => `${pickerId}-${option().id}`;
              return (
                <div
                  class={[
                    "provider-picker-option",
                    {
                      "provider-picker-option-selected": checkedProvider() === option().id,
                      "provider-picker-option-unavailable": !available(),
                      "provider-picker-option-runtime": Boolean(runtimeStatus()),
                      "provider-picker-option-selectable-unavailable":
                        !available() && Boolean(props.allowUnavailableSelection),
                    },
                  ]}
                  title={option().message ?? undefined}
                >
                  <label for={inputId()} class="provider-picker-option-selection">
                    <Input
                      id={inputId()}
                      ref={(element) => inputs.set(option().id, element)}
                      type="radio"
                      name={props.ariaLabel}
                      value={option().id}
                      checked={checkedProvider() === option().id}
                      disabled={props.disabled || (!props.allowUnavailableSelection && !available())}
                      onChange={() => props.onChange(option().id)}
                    />
                    <Show
                      when={daniRow()}
                      fallback={<ProviderLogo provider={option().id} class="provider-picker-logo" />}
                    >
                      <AppLogo variant="production" class="provider-picker-logo" />
                    </Show>
                    <span class="provider-picker-identity">
                      <span class="provider-picker-name">{daniRow() ? "Dani Free" : option().name}</span>
                      <Show when={daniRow() ? "Free models, picked for you" : (option().email ?? option().description)}>
                        {(detail) => <small class="provider-picker-email">{detail()}</small>}
                      </Show>
                      <Show when={option().id === "codex" && !available() && option().message}>
                        {(message) => <small class="provider-picker-check-error">{message()}</small>}
                      </Show>
                      <Show when={runtimeStatus()?.phase === "download-error" && runtimeStatus()?.message}>
                        {(message) => <small class="provider-picker-check-error">{message()}</small>}
                      </Show>
                      <Show when={option().checkError}>
                        {(checkError) => <small class="provider-picker-check-error">{checkError()}</small>}
                      </Show>
                    </span>
                    {/* Version shares the badge column. */}
                    <span class="provider-picker-state">
                      <Show when={daniRow() ? null : version()}>
                        {(installed) => <small class="provider-picker-version">{installed()}</small>}
                      </Show>
                      {/* Free-tier badge only beside runtime badge. */}
                      <Show
                        when={
                          option().id === "opencode" &&
                          (option().keyStatus === "missing" || option().keyStatus === "unreadable")
                        }
                      >
                        <Badge class="provider-picker-status provider-picker-key-status" tone="neutral" shape="pill">
                          {i18n.t("provider.key.free")}
                        </Badge>
                      </Show>
                      <Show when={runtimeStatus()?.phase !== "not-downloaded" || updatable()}>
                        <Badge
                          class={`provider-picker-status provider-picker-status-${visualState()}`}
                          tone={providerStatusTone(visualState())}
                          shape="pill"
                        >
                          {providerStatusLabel(i18n.t, state(), connecting(), runtimeStatus(), updatable())}
                        </Badge>
                      </Show>
                    </span>
                  </label>
                  {/* Actions share one grid cell; a sibling button would stretch its own row. */}
                  <div class="provider-picker-actions">
                    <Show when={runtimeAction()}>
                      {(action) => (
                        <Button
                          type="button"
                          variant={action() === "download" ? "default" : "outline"}
                          size="xs"
                          class="provider-picker-install"
                          aria-label={i18n.t(PROVIDER_ACTION_LABEL[action()], { name: option().name })}
                          disabled={props.disabled || (props.refreshingProviders && !runtimeStoreAction(action()))}
                          onClick={() => {
                            if (action() === "cancel") {
                              void props.onCancelProviderDownload?.(option().id);
                            } else if (action() !== "download" && action() !== "retry") {
                              // Reconnect retries the keyless runtime. A paid-model key is an
                              // optional, separate action, never a requirement for free models.
                              void props.onConnectProvider?.(option().id);
                            } else {
                              void props.onDownloadProvider?.(option().id);
                            }
                          }}
                        >
                          {i18n.t(PROVIDER_ACTION_TEXT[action()])}
                        </Button>
                      )}
                    </Show>
                    {/* Update sits last, never replaces runtime action. */}
                    <Show when={updatable() && props.onUpdateProvider}>
                      <Button
                        type="button"
                        variant="default"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={i18n.t("provider.aria.update", {
                          name: option().name,
                          version: option().availableVersion ?? "",
                        })}
                        disabled={props.disabled || props.refreshingProviders || connecting()}
                        onClick={() => void props.onUpdateProvider?.(option().id)}
                      >
                        {i18n.t("provider.action.update")}
                      </Button>
                    </Show>
                    <Show
                      when={
                        !runtimeStatus() &&
                        agentProviderDescriptor(option().id).installGuideLink !== null &&
                        state() === "not-installed" &&
                        !props.onConnectProvider &&
                        props.onInstallProvider
                      }
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={i18n.t("provider.aria.install", { name: option().name })}
                        disabled={props.disabled || props.refreshingProviders}
                        onClick={() => void props.onInstallProvider?.(option().id)}
                      >
                        {i18n.t("provider.action.install")}
                      </Button>
                    </Show>
                    <Show
                      when={
                        (!runtimeStatus() || (option().id === "codex" && runtimeStatus()?.phase === "ready")) &&
                        props.onConnectProvider
                      }
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={
                          option().id === "codex"
                            ? "Sign in with ChatGPT"
                            : i18n.t(PROVIDER_ACTION_LABEL[providerAction(state(), connecting())], {
                                name: option().name,
                              })
                        }
                        aria-busy={connecting() ? "true" : undefined}
                        disabled={props.disabled || props.refreshingProviders}
                        onClick={() => void props.onConnectProvider?.(option().id)}
                      >
                        <Show when={connecting()}>
                          <Spinner size="sm" />
                        </Show>
                        {option().id === "codex"
                          ? connecting()
                            ? "Signing in..."
                            : "Sign in with ChatGPT"
                          : i18n.t(PROVIDER_ACTION_TEXT[providerAction(state(), connecting())])}
                      </Button>
                    </Show>
                    {/* The free row never offers a key action. Paid-model key management lives in Settings. */}
                    <Show
                      when={
                        props.onSignInProvider &&
                        option().id === "claude" &&
                        !runtimeStatus() &&
                        state() === "sign-in-required" &&
                        !props.onConnectProvider
                      }
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        class="provider-picker-install"
                        aria-label={i18n.t("provider.aria.signIn", { name: option().name })}
                        disabled={props.disabled || props.refreshingProviders}
                        onClick={() => void props.onSignInProvider?.(option().id)}
                      >
                        {i18n.t("provider.action.signIn")}
                      </Button>
                    </Show>
                    <Show when={props.onOptionalApiKey && (option().id === "claude" || option().id === "grok")}>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => props.onOptionalApiKey?.(option().id)}
                      >
                        Optional API key
                      </Button>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={customSelectable() ? openCode() : undefined}>{(engine) => customRow(engine)}</Show>
        </div>
        <Show when={!customSelectable() && props.onAddCustomProvider ? openCode() : undefined}>
          {(engine) => customRow(engine)}
        </Show>
      </div>
      <Show when={props.hint}>{(hint) => <p class="provider-picker-hint">{hint()}</p>}</Show>
    </div>
  );
}

function servesCustomProvider(openCode: ProviderPickerOption | undefined): boolean {
  return openCode?.state === "available" || openCode?.state === "sign-in-required";
}

type ProviderVisualState = AgentProviderState | ProviderRuntimePhase | "connecting" | "update-available";

function providerStatusTone(state: ProviderVisualState): "success" | "warning" | "danger" | "neutral" {
  if (state === "available") return "success";
  if (state === "ready") return "success";
  if (state === "error" || state === "download-error") return "danger";
  if (state === "sign-in-required" || state === "outdated" || state === "finishing") return "warning";
  if (state === "update-available") return "warning";
  return "neutral";
}

function providerStatusLabel(
  translate: AppTranslate,
  state: AgentProviderState,
  connecting = false,
  runtimeStatus?: ProviderRuntimeStatus,
  updatable = false,
): string {
  // Downloads outrank connection words; the row reports progress until it ends.
  if (runtimeStatus?.phase === "downloading") {
    return `${Math.round(Math.max(0, Math.min(100, runtimeStatus.progress ?? 0)))}%`;
  }
  if (runtimeStatus?.phase === "finishing") return translate("provider.status.settingUp");
  if (connecting && state !== "available") return translate("provider.status.connecting");
  // Update offers outrank "Connected"/"Ready": a hidden offer is never taken.
  if (updatable) return translate("provider.status.updateAvailable");
  if (runtimeStatus?.phase === "download-error")
    return runtimeStatus.failureStage === "connection"
      ? "Connection failed"
      : translate("provider.status.downloadFailed");
  if (state === "available") return translate("provider.status.connected");
  if (runtimeStatus?.phase === "not-downloaded") return translate("provider.status.notDownloaded");
  if (runtimeStatus?.phase === "ready") return translate("provider.status.ready");
  if (state === "sign-in-required") return translate("provider.status.notConnected");
  if (state === "not-installed") return translate("provider.status.notInstalled");
  if (state === "outdated") return translate("provider.status.updateRequired");
  if (state === "error") return translate("provider.status.unavailable");
  return translate("provider.status.checking");
}

function providerVisualState(
  state: AgentProviderState,
  connecting: boolean,
  runtimeStatus?: ProviderRuntimeStatus,
  updatable = false,
): ProviderVisualState {
  const phase = runtimeStatus?.phase;
  // Same order as the label above.
  if (phase === "downloading" || phase === "finishing") return phase;
  if (connecting && state !== "available") return "connecting";
  if (updatable) return "update-available";
  if (phase === "download-error") return phase;
  if (state === "available") return "available";
  return phase ?? state;
}

type ProviderAction = "download" | "cancel" | "connect" | "reconnect" | "restart" | "retry";

const PROVIDER_ACTION_TEXT = {
  download: "provider.action.download",
  cancel: "provider.action.cancel",
  connect: "provider.action.connect",
  reconnect: "provider.action.reconnect",
  restart: "provider.action.restart",
  retry: "provider.action.retry",
} as const satisfies Record<ProviderAction, AppTextKey>;

const PROVIDER_ACTION_LABEL = {
  download: "provider.aria.download",
  cancel: "provider.aria.cancel",
  connect: "provider.aria.connect",
  reconnect: "provider.aria.reconnect",
  restart: "provider.aria.restart",
  retry: "provider.aria.retry",
} as const satisfies Record<ProviderAction, keyof AppMessages>;

function runtimeStoreAction(action: ProviderAction): boolean {
  return action === "download" || action === "cancel" || action === "retry";
}

function providerRuntimeAction(
  state: AgentProviderState,
  connecting: boolean,
  runtimeStatus?: ProviderRuntimeStatus,
): ProviderAction | undefined {
  if (!runtimeStatus) return;
  if (runtimeStatus.phase === "not-downloaded") return "download";
  if (runtimeStatus.phase === "downloading") return "cancel";
  if (runtimeStatus.phase === "ready") return providerAction(state, connecting);
  if (runtimeStatus.phase === "download-error") return "retry";
}

function providerAction(state: AgentProviderState, connecting: boolean): ProviderAction {
  if (connecting) return "restart";
  return state === "available" ? "reconnect" : "connect";
}
