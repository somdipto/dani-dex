import { CONTEXT_IMPORT_LIMITS } from "@dani-dex/contracts/context-import";
import { CONTEXT_EXPORT_PROMPT } from "@dani-dex/contracts/context-import-prompt";
import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import { redactContextText } from "@dani-dex/logging";
import { createStore, For, onSettled, Show } from "solid-js";
import { Button, Textarea } from "../../components/ui";
import { errorMessage } from "../../error-message";
import { type ImportEntry, type ImportProvider, parseImport } from "./context-import";
import { PROVIDER_LOGOS } from "./provider-logos";

export function ContextImportPanel(props: {
  room: number;
  limit: number;
  /** Saves the texts and returns the ones that failed. Already-saved texts must be skipped by the caller. */
  onSave: (texts: string[]) => Promise<string[]>;
  doneLabel: (n: number) => string;
}) {
  const [state, setState] = createStore<{
    open: boolean;
    provider: ImportProvider | null;
    pasted: string;
    entries: ImportEntry[] | null;
    rejected: string[];
    copied: boolean;
    status: string | null;
    saving: boolean;
  }>({
    open: false,
    provider: null,
    pasted: "",
    entries: null,
    rejected: [],
    copied: false,
    status: null,
    saving: false,
  });
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onSettled(() => () => clearTimeout(copiedTimer));
  const maxLen = INPUT_LIMITS.agentMemoryText;

  const room = () => Math.max(0, props.room);
  const tooLong = (e: ImportEntry) => e.text.length > maxLen;
  const selected = () => (state.entries ?? []).filter((e) => e.keep && !tooLong(e) && e.text.trim().length > 0);
  const willSave = () => selected().slice(0, room());
  const overCapacity = () => selected().slice(room());

  function reset() {
    if (state.saving) return;
    clearTimeout(copiedTimer);
    setState((draft) => {
      draft.provider = null;
      draft.pasted = "";
      draft.entries = null;
      draft.rejected = [];
      draft.status = null;
      draft.copied = false;
    });
  }
  async function copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(CONTEXT_EXPORT_PROMPT);
      setState((draft) => {
        draft.copied = true;
      });
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(
        () =>
          setState((draft) => {
            draft.copied = false;
          }),
        2000,
      );
      return true;
    } catch {
      return false;
    }
  }
  /** Opens the provider with the prompt in the link (the page may ignore it) and copies it as the fallback. */
  async function start(name: ImportProvider) {
    setState((draft) => {
      draft.provider = name;
    });
    const problems: string[] = [];
    if (!(await copy())) problems.push("Could not copy the prompt automatically. Select the prompt below and copy it.");
    try {
      await window.danidex.openExternal(name === "ChatGPT" ? "import-chatgpt" : "import-claude");
    } catch {
      problems.push(`Could not open ${name}. Open it yourself and paste the prompt.`);
    }
    setState((draft) => {
      draft.status = problems.length ? problems.join(" ") : null;
    });
  }
  function preview() {
    const p = state.provider;
    if (!p || !state.pasted.trim()) return;
    if (state.pasted.length > CONTEXT_IMPORT_LIMITS.pastedText) {
      setState((draft) => {
        draft.status = "The pasted context is too large. Import a smaller section.";
      });
      return;
    }
    const result = parseImport(state.pasted, p);
    setState((draft) => {
      draft.entries = result.entries;
      draft.rejected = result.rejected;
      draft.pasted = redactContextText(draft.pasted);
      draft.status = result.entries.length ? null : "No lines in the requested format were found. Nothing to import.";
    });
  }
  function setText(id: number, text: string) {
    setState((draft) => {
      draft.entries = (draft.entries ?? []).map((e) => (e.id === id ? { ...e, text } : e));
    });
  }
  function setKeep(id: number, keep: boolean) {
    setState((draft) => {
      draft.entries = (draft.entries ?? []).map((e) => (e.id === id ? { ...e, keep } : e));
    });
  }
  async function save() {
    // Edits can add secret-like text after the preview, so everything is cleaned again here.
    const items = willSave().map((item) => ({ id: item.id, text: redactContextText(item.text.trim()) }));
    if (!items.length || state.saving) return;
    setState((draft) => {
      draft.saving = true;
    });
    try {
      const failed = new Set(await props.onSave(items.map((item) => item.text)));
      const savedIds = new Set(items.filter((item) => !failed.has(item.text)).map((item) => item.id));
      const remaining = (state.entries ?? []).filter((entry) => !savedIds.has(entry.id));
      const savedCount = savedIds.size;
      setState((draft) => {
        draft.status =
          failed.size > 0
            ? `Saved ${savedCount}. ${failed.size} did not save and are kept here. Press save to retry.`
            : props.doneLabel(savedCount);
      });
      if (remaining.length > 0) {
        setState((draft) => {
          draft.entries = remaining;
        });
      } else {
        setState((draft) => {
          draft.entries = null;
        });
        setState((draft) => {
          draft.pasted = "";
        });
        setState((draft) => {
          draft.provider = null;
        });
      }
    } catch (caught) {
      setState((draft) => {
        draft.status = errorMessage(caught, "Could not save.");
      });
    } finally {
      setState((draft) => {
        draft.saving = false;
      });
    }
  }

  return (
    <section class="agent-memory-composer" aria-label="Import context">
      <Show
        when={state.open}
        fallback={
          <div class="agent-memory-composer-actions">
            <Button
              size="sm"
              variant="default"
              onClick={() =>
                setState((draft) => {
                  draft.open = true;
                })
              }
            >
              Import from ChatGPT or Claude
            </Button>
          </div>
        }
      >
        <Show when={!state.provider}>
          <div class="context-import-cards">
            <For each={["ChatGPT", "Claude"] as const}>
              {(name) => (
                <Button
                  type="button"
                  variant="ghost"
                  class="context-import-card"
                  aria-label={`Import from ${name}`}
                  onClick={() => void start(name)}
                >
                  <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" fill={PROVIDER_LOGOS[name].color}>
                    <path d={PROVIDER_LOGOS[name].path} />
                  </svg>
                  <strong>{name}</strong>
                  <span class="context-import-card-note">Import what it remembers</span>
                </Button>
              )}
            </For>
          </div>
          <div class="agent-memory-composer-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                reset();
                setState((draft) => {
                  draft.open = false;
                });
              }}
            >
              Close
            </Button>
          </div>
        </Show>
        <Show when={state.provider && !state.entries}>
          <p>1. Send this prompt to {state.provider}. Use Copy prompt if it was not copied.</p>
          <p class="context-import-prompt">{CONTEXT_EXPORT_PROMPT}</p>
          <div class="agent-memory-composer-actions">
            <Button size="sm" variant="default" onClick={() => void copy()}>
              {state.copied ? "Copied" : "Copy prompt"}
            </Button>
          </div>
          <p>2. Paste {state.provider}'s answer here.</p>
          <Textarea
            rows="6"
            value={state.pasted}
            placeholder="Paste the list here"
            aria-label="Pasted answer"
            onValueChange={(value) =>
              setState((draft) => {
                draft.pasted = value;
              })
            }
          />
          <div class="agent-memory-composer-actions">
            <Button size="sm" variant="ghost" onClick={reset}>
              Back
            </Button>
            <Button size="sm" variant="default" disabled={!state.pasted.trim()} onClick={preview}>
              Preview
            </Button>
          </div>
        </Show>
        <Show when={state.entries}>
          {(list) => (
            <>
              <p>
                {list().length} entries found. Saving {willSave().length} (room for {room()} of {props.limit}). Untick
                or edit before saving. Likely credentials were removed automatically.
              </p>
              <For each={list()}>
                {(entry) => (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-pressed={entry.keep ? "true" : "false"}
                      disabled={state.saving}
                      onClick={() => setKeep(entry.id, !entry.keep)}
                    >
                      {entry.keep ? "Keep: yes" : "Keep: no"}
                    </Button>
                    <Textarea
                      rows="2"
                      value={entry.text}
                      aria-label="Imported entry"
                      disabled={state.saving}
                      onValueChange={(v) => setText(entry.id, v)}
                    />
                    <Show when={tooLong(entry)}>
                      <p role="alert">
                        Skipped: {entry.text.length} characters, over the {maxLen} limit. Shorten it to include it.
                      </p>
                    </Show>
                    <Show when={entry.redacted}>
                      <p>Credential-like text was removed from this entry.</p>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={state.rejected.length > 0}>
                <p role="alert">
                  {state.rejected.length} lines were not in the requested "fact | Source | Uncertainty" format and will
                  not be saved:{" "}
                  {state.rejected
                    .slice(0, 3)
                    .map((line) => line.slice(0, 60))
                    .join(" / ")}
                  {state.rejected.length > 3 ? " ..." : ""}
                </p>
              </Show>
              <Show when={overCapacity().length > 0}>
                <p role="alert">
                  Not saved, no room left: {overCapacity().length} entries. Delete older memories or untick others to
                  make room.
                </p>
              </Show>
              <div class="agent-memory-composer-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={state.saving}
                  onClick={() =>
                    setState((draft) => {
                      draft.entries = null;
                    })
                  }
                >
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={state.saving || !willSave().length}
                  loading={state.saving}
                  onClick={() => void save()}
                >
                  Save {willSave().length} memories
                </Button>
              </div>
            </>
          )}
        </Show>
        <Show when={state.status}>{(m) => <p role="status">{m()}</p>}</Show>
      </Show>
    </section>
  );
}
