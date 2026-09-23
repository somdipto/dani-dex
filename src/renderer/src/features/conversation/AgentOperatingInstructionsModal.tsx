import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import { type AgentOperatingInstructions, OPERATING_INSTRUCTIONS_REFRESH_TURNS } from "@dani-dex/contracts/ipc";
import { createEffect, createSignal, Show } from "solid-js";
import { Button, Dialog, IconButton, RefreshCw, SwitchField, Textarea, X } from "../../components/ui";
import { errorMessage } from "../../error-message";

interface AgentOperatingInstructionsModalProps {
  agentId: string;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (instructions: AgentOperatingInstructions) => void;
}

/**
 * The bot's working method, as the provider receives it. The bot rewrites it from the user's own
 * messages every few turns; the user can rewrite it here, pause the rewrites, or ask for one now.
 */
export function AgentOperatingInstructionsModal(props: AgentOperatingInstructionsModalProps) {
  const [current, setCurrent] = createSignal<AgentOperatingInstructions | null>(null);
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal<"load" | "save" | "refresh" | "toggle" | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  function accept(next: AgentOperatingInstructions): void {
    setCurrent(next);
    setText(next.text);
    props.onChange(next);
  }

  async function run(kind: "load" | "save" | "refresh" | "toggle", action: () => Promise<AgentOperatingInstructions>) {
    setBusy(kind);
    setError(null);
    try {
      accept(await action());
    } catch (caught) {
      setError(errorMessage(caught, "Could not update the operating instructions."));
    } finally {
      setBusy(null);
    }
  }

  createEffect(
    () => [props.open, props.agentId] as const,
    ([open, agentId]) => {
      if (!open) return;
      void run("load", () => window.danidex.agent.getOperatingInstructions(agentId));
    },
  );

  const dirty = () => text().trim() !== (current()?.text ?? "");

  function status(value: AgentOperatingInstructions): string {
    if (value.refreshing) return "Rewriting from your recent messages…";
    const origin =
      value.source === "none"
        ? `None yet. ${props.agentName} writes the first version after ${OPERATING_INSTRUCTIONS_REFRESH_TURNS} of your messages.`
        : value.source === "edited"
          ? "Edited by you."
          : `Written by ${props.agentName} from your messages.`;
    if (!value.autoEvolve) return `${origin} Updates are paused.`;
    if (value.source === "none") return origin;
    const turns = value.turnsUntilRefresh;
    return `${origin} Next update after ${turns} more ${turns === 1 ? "message" : "messages"}.`;
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="agent-memories-overlay" />
        <Dialog.Content class="agent-memories-modal agent-operating-instructions-modal">
          <header class="agent-memories-header">
            <div class="agent-memories-heading">
              <Dialog.Title>Operating instructions</Dialog.Title>
              <Dialog.Description class="sr-only">
                How {props.agentName} works for you, updated from your messages
              </Dialog.Description>
            </div>
            <div class="agent-memories-header-actions">
              <IconButton
                label="Update now from recent messages"
                variant="ghost"
                disabled={busy() !== null || dirty() || current()?.refreshing === true}
                onClick={() =>
                  void run("refresh", () => window.danidex.agent.refreshOperatingInstructions(props.agentId))
                }
              >
                <RefreshCw />
              </IconButton>
              <IconButton
                label="Close operating instructions"
                variant="ghost"
                onClick={() => props.onOpenChange(false)}
              >
                <X />
              </IconButton>
            </div>
          </header>
          <div class="agent-memories-body agent-operating-instructions-body">
            <Show when={current()}>{(value) => <p class="agent-memory-meta">{status(value())}</p>}</Show>
            <Textarea
              class="agent-operating-instructions-input"
              rows="12"
              maxlength={INPUT_LIMITS.agentOperatingInstructions}
              value={text()}
              placeholder="- One line per habit, e.g. write the spec before the code"
              aria-label="Operating instructions"
              disabled={busy() === "load" || busy() === "refresh"}
              onValueChange={setText}
            />
            <Show when={error()}>
              {(message) => (
                <p class="agent-memory-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <SwitchField
              label="Keep updating"
              description={`Rewrite these every ${OPERATING_INSTRUCTIONS_REFRESH_TURNS} of your messages. Your edits are kept.`}
              checked={current()?.autoEvolve ?? true}
              disabled={busy() !== null || current() === null}
              onChange={(autoEvolve) =>
                void run("toggle", () =>
                  window.danidex.agent.updateOperatingInstructions({ agentId: props.agentId, autoEvolve }),
                )
              }
            />
          </div>
          <footer class="agent-memories-footer agent-operating-instructions-footer">
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty() || busy() !== null}
              onClick={() => setText(current()?.text ?? "")}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={!dirty() || busy() !== null}
              loading={busy() === "save"}
              onClick={() =>
                void run("save", () =>
                  window.danidex.agent.updateOperatingInstructions({ agentId: props.agentId, text: text() }),
                )
              }
            >
              Save
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
