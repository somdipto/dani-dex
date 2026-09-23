import { AGENT_HARNESS_DESCRIPTORS, type AgentHarnessSetting } from "@dani-dex/contracts/ipc";
import type { AppTextKey } from "@dani-dex/i18n";
import { createSignal, Show } from "solid-js";
import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  Text,
} from "../../components/ui";
import { useI18n } from "../../i18n-context";

/** `provider` is the stored absence of a harness: each provider's own CLI runs the turn. */
export type HarnessChoice = AgentHarnessSetting | "provider";

export interface HarnessSettingsApi {
  /** What is saved for the next launch. `null` is the provider's own CLI. */
  saved: () => AgentHarnessSetting | null;
  /** What the running agents use. It only changes on relaunch. */
  active: () => AgentHarnessSetting | null;
  onChange: (harness: AgentHarnessSetting | null) => Promise<void>;
  onRelaunch: () => Promise<void>;
}

const CHOICES: readonly HarnessChoice[] = [
  "automatic",
  "provider",
  ...AGENT_HARNESS_DESCRIPTORS.map((harness) => harness.id),
];

const CHOICE_KEYS = {
  automatic: "settings.harness.automatic",
  provider: "settings.harness.provider",
  hermes: "settings.harness.hermes",
  omp: "settings.harness.omp",
} as const satisfies Record<HarnessChoice, AppTextKey>;

function toChoice(harness: AgentHarnessSetting | null): HarnessChoice {
  return harness ?? "provider";
}

function fromChoice(choice: HarnessChoice): AgentHarnessSetting | null {
  return choice === "provider" ? null : choice;
}

function choiceAvailable(choice: HarnessChoice): boolean {
  if (choice === "provider" || choice === "automatic") return true;
  return AGENT_HARNESS_DESCRIPTORS.find((harness) => harness.id === choice)?.available === true;
}

export function HarnessSettings(props: { api: HarnessSettingsApi; selectMount: HTMLElement | undefined }) {
  const i18n = useI18n();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<AppTextKey | null>(null);
  const label = (choice: HarnessChoice | undefined) => (choice === undefined ? "" : i18n.t(CHOICE_KEYS[choice]));
  const restartPending = () => props.api.saved() !== props.api.active();

  async function choose(choice: HarnessChoice) {
    if (!choiceAvailable(choice) || fromChoice(choice) === props.api.saved()) return;
    setBusy(true);
    setError(null);
    try {
      await props.api.onChange(fromChoice(choice));
    } catch {
      setError("settings.harness.saveFailed");
    } finally {
      setBusy(false);
    }
  }

  async function relaunch() {
    setBusy(true);
    setError(null);
    try {
      await props.api.onRelaunch();
    } catch {
      setError("settings.harness.restartFailed");
      setBusy(false);
    }
  }

  return (
    <SettingsSection title={i18n.t("settings.harness.title")} description={i18n.t("settings.harness.description")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{i18n.t("settings.harness.rowTitle")}</ItemTitle>
            <ItemDescription>{i18n.t("settings.harness.rowDescription")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select<HarnessChoice>
              class="settings-modal-select"
              options={[...CHOICES]}
              value={toChoice(props.api.saved())}
              disabled={busy()}
              optionDisabled={(choice) => !choiceAvailable(choice)}
              onChange={(choice) => choice && void choose(choice)}
              placement="bottom-end"
              itemComponent={(selectProps) => (
                <SelectItem item={selectProps.item}>{label(selectProps.item.rawValue)}</SelectItem>
              )}
            >
              <SelectTrigger size="sm" aria-label={i18n.t("settings.harness.rowTitle")}>
                <SelectValue<HarnessChoice>>{(state) => label(state.selectedOption())}</SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.selectMount} />
            </Select>
          </ItemActions>
        </Item>
        <Show when={restartPending()}>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemDescription role="status">{i18n.t("settings.harness.restartNote")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="default" disabled={busy()} onClick={() => void relaunch()}>
                {i18n.t("settings.harness.restart")}
              </Button>
            </ItemActions>
          </Item>
        </Show>
      </ItemGroup>
      <Show when={error()}>
        {(key) => (
          <Text tone="muted" variant="caption" role="alert">
            {i18n.t(key())}
          </Text>
        )}
      </Show>
    </SettingsSection>
  );
}
