/**
 * The user's own OpenAI API key for voice calls (bring your own key).
 *
 * As with the OpenCode key, a saved key is reported as a fact and never read back into the input:
 * main has no getter for it, so no screenshot or crash report can carry it.
 */

import type { ProviderApiKeyStatus } from "@dani-dex/contracts/ipc";
import type { AppTextKey } from "@dani-dex/i18n";
import { createSignal, onSettled, Show } from "solid-js";
import {
  Button,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Text,
} from "../../components/ui";
import { useI18n } from "../../i18n-context";

export interface VoiceKeyApi {
  getRealtimeApiKeyStatus: () => Promise<ProviderApiKeyStatus>;
  setRealtimeApiKey: (key: string) => Promise<ProviderApiKeyStatus>;
  clearRealtimeApiKey: () => Promise<ProviderApiKeyStatus>;
}

const STATUS_KEYS = {
  missing: "settings.voiceKey.missing",
  saved: "settings.voiceKey.saved",
  unreadable: "settings.voiceKey.unreadable",
} as const satisfies Record<ProviderApiKeyStatus, AppTextKey>;

export function VoiceKeySettings(props: { api: VoiceKeyApi }) {
  const i18n = useI18n();
  const [key, setKey] = createSignal("");
  const [status, setStatus] = createSignal<ProviderApiKeyStatus>("missing");
  const [busy, setBusy] = createSignal(true);
  const [error, setError] = createSignal<AppTextKey | null>(null);

  onSettled(() => {
    void run(() => props.api.getRealtimeApiKeyStatus(), "settings.voiceKey.readFailed");
  });

  async function run(action: () => Promise<ProviderApiKeyStatus>, failure: AppTextKey): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      // The typed key is dropped once main holds it: the renderer keeps no copy of a secret.
      setKey("");
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  function save(): void {
    const value = key().trim();
    if (busy() || !value) return;
    void run(() => props.api.setRealtimeApiKey(value), "settings.voiceKey.saveFailed");
  }

  return (
    <SettingsSection title={i18n.t("settings.voiceKey.title")} description={i18n.t("settings.voiceKey.description")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{i18n.t("settings.voiceKey.rowTitle")}</ItemTitle>
            <ItemDescription role="status">{i18n.t(STATUS_KEYS[status()])}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <form
              class="settings-voice-key-form"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <Input
                type="password"
                size="sm"
                autocomplete="off"
                spellcheck={false}
                aria-label={i18n.t("settings.voiceKey.rowTitle")}
                placeholder={i18n.t("settings.voiceKey.placeholder")}
                value={key()}
                disabled={busy()}
                onValueChange={setKey}
              />
              <Button type="submit" size="sm" variant="default" disabled={busy() || !key().trim()}>
                {i18n.t("settings.voiceKey.save")}
              </Button>
              <Show when={status() !== "missing"}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy()}
                  onClick={() => void run(() => props.api.clearRealtimeApiKey(), "settings.voiceKey.removeFailed")}
                >
                  {i18n.t("settings.voiceKey.remove")}
                </Button>
              </Show>
            </form>
          </ItemActions>
        </Item>
      </ItemGroup>
      <Show when={error()}>
        {(message) => (
          <Text tone="muted" variant="caption" role="alert">
            {i18n.t(message())}
          </Text>
        )}
      </Show>
    </SettingsSection>
  );
}
