import { CONTEXT_EXPORT_PROMPT } from "@dani-dex/contracts/context-import-prompt";
import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import { createSignal, For, Show } from "solid-js";
import { Button, Textarea } from "../../components/ui";
import { errorMessage } from "../../error-message";
import { PROVIDER_LOGOS } from "./provider-logos";

type Provider = "ChatGPT" | "Claude";

const SECRET =
  /(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._-]{16,}|(?:access_token|refresh_token|api[_-]?key|secret|password)\s*[:=]\s*\S+|\b(?:\d[ -]?){13,19}\b)/gi;
/** The shape the prompt asks for: "- fact | Source: ... | Uncertainty: ...". */
const EXPECTED_LINE = /\|\s*Source:.+\|\s*Uncertainty:/i;

interface Entry {
  id: number;
  text: string;
  keep: boolean;
  redacted: boolean;
}

export function redact(raw: string): { text: string; redacted: boolean } {
  const noKeys = raw.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    "[private key removed]",
  );
  const text = noKeys.replace(SECRET, "[removed]");
  return { text, redacted: text !== raw };
}

/** Lines in the requested shape become entries. Other non-empty lines are returned, never saved. */
export function parseImport(raw: string, provider: Provider): { entries: Entry[]; rejected: string[] } {
  const entries: Entry[] = [];
  const rejected: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const body = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (body.length < 4 || body.startsWith("```") || /^[A-Za-z ]+:$/.test(body)) continue;
    if (!EXPECTED_LINE.test(body)) {
      rejected.push(body);
      continue;
    }
    const clean = redact(body);
    entries.push({
      id: entries.length,
      text: `Imported from ${provider} (historical): ${clean.text}`,
      keep: true,
      redacted: clean.redacted,
    });
  }
  return { entries, rejected };
}

export function ContextImportPanel(props: {
  room: number;
  limit: number;
  /** Saves the texts and returns the ones that failed. Already-saved texts must be skipped by the caller. */
  onSave: (texts: string[]) => Promise<string[]>;
  doneLabel: (n: number) => string;
}) {
  const [open, setOpen] = createSignal(false);
  const [provider, setProvider] = createSignal<Provider | null>(null);
  const [pasted, setPasted] = createSignal("");
  const [entries, setEntries] = createSignal<Entry[] | null>(null);
  const [rejected, setRejected] = createSignal<string[]>([]);
  const [copied, setCopied] = createSignal(false);
  const [status, setStatus] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const maxLen = INPUT_LIMITS.agentMemoryText;

  const room = () => Math.max(0, props.room);
  const tooLong = (e: Entry) => e.text.length > maxLen;
  const selected = () => (entries() ?? []).filter((e) => e.keep && !tooLong(e) && e.text.trim().length > 0);
  const willSave = () => selected().slice(0, room());
  const overCapacity = () => selected().slice(room());

  function reset() {
    setProvider(null);
    setPasted("");
    setEntries(null);
    setRejected([]);
    setStatus(null);
  }
  async function copy(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(CONTEXT_EXPORT_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      return false;
    }
  }
  /** Opens the provider with the prompt in the link (the page may ignore it) and copies it as the fallback. */
  async function start(name: Provider) {
    setProvider(name);
    const problems: string[] = [];
    if (!(await copy())) problems.push("Could not copy the prompt automatically. Select the prompt below and copy it.");
    try {
      await window.danidex.openExternal(name === "ChatGPT" ? "import-chatgpt" : "import-claude");
    } catch {
      problems.push(`Could not open ${name}. Open it yourself and paste the prompt.`);
    }
    setStatus(problems.length ? problems.join(" ") : null);
  }
  function preview() {
    const p = provider();
    if (!p || !pasted().trim()) return;
    const result = parseImport(pasted(), p);
    setEntries(result.entries);
    setRejected(result.rejected);
    setStatus(result.entries.length ? null : "No lines in the requested format were found. Nothing to import.");
  }
  function setText(id: number, text: string) {
    setEntries((list) => (list ?? []).map((e) => (e.id === id ? { ...e, text } : e)));
  }
  function setKeep(id: number, keep: boolean) {
    setEntries((list) => (list ?? []).map((e) => (e.id === id ? { ...e, keep } : e)));
  }
  async function save() {
    // Edits can add secret-like text after the preview, so everything is cleaned again here.
    const items = willSave().map((item) => ({ id: item.id, text: redact(item.text.trim()).text }));
    if (!items.length) return;
    setSaving(true);
    try {
      const failed = new Set(await props.onSave(items.map((item) => item.text)));
      const stillFailed = items.filter((item) => failed.has(item.text)).map((item) => item.id);
      const savedCount = items.length - stillFailed.length;
      if (stillFailed.length === 0) {
        setStatus(props.doneLabel(savedCount));
        setEntries(null);
        setPasted("");
        setProvider(null);
      } else {
        setEntries((list) => (list ?? []).filter((e) => stillFailed.includes(e.id)));
        setStatus(`Saved ${savedCount}. ${stillFailed.length} did not save and are kept here. Press save to retry.`);
      }
    } catch (caught) {
      setStatus(errorMessage(caught, "Could not save."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section class="agent-memory-composer" aria-label="Import context">
      <Show
        when={open()}
        fallback={
          <div class="agent-memory-composer-actions">
            <Button size="sm" variant="default" onClick={() => setOpen(true)}>
              Import from ChatGPT or Claude
            </Button>
          </div>
        }
      >
        <Show when={!provider()}>
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
                setOpen(false);
              }}
            >
              Close
            </Button>
          </div>
        </Show>
        <Show when={provider() && !entries()}>
          <p>1. Send this prompt to {provider()}. It was copied for you.</p>
          <p class="context-import-prompt">{CONTEXT_EXPORT_PROMPT}</p>
          <div class="agent-memory-composer-actions">
            <Button size="sm" variant="default" onClick={() => void copy()}>
              {copied() ? "Copied" : "Copy prompt"}
            </Button>
          </div>
          <p>2. Paste {provider()}'s answer here.</p>
          <Textarea
            rows="6"
            value={pasted()}
            placeholder="Paste the list here"
            aria-label="Pasted answer"
            onValueChange={setPasted}
          />
          <div class="agent-memory-composer-actions">
            <Button size="sm" variant="ghost" onClick={reset}>
              Back
            </Button>
            <Button size="sm" variant="default" disabled={!pasted().trim()} onClick={preview}>
              Preview
            </Button>
          </div>
        </Show>
        <Show when={entries()}>
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
                      onClick={() => setKeep(entry.id, !entry.keep)}
                    >
                      {entry.keep ? "Keep: yes" : "Keep: no"}
                    </Button>
                    <Textarea
                      rows="2"
                      value={entry.text}
                      aria-label="Imported entry"
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
              <Show when={rejected().length > 0}>
                <p role="alert">
                  {rejected().length} lines were not in the requested "fact | Source | Uncertainty" format and will not
                  be saved:{" "}
                  {rejected()
                    .slice(0, 3)
                    .map((line) => line.slice(0, 60))
                    .join(" / ")}
                  {rejected().length > 3 ? " ..." : ""}
                </p>
              </Show>
              <Show when={overCapacity().length > 0}>
                <p role="alert">
                  Not saved, no room left: {overCapacity().length} entries. Delete older memories or untick others to
                  make room.
                </p>
              </Show>
              <div class="agent-memory-composer-actions">
                <Button size="sm" variant="ghost" onClick={() => setEntries(null)}>
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={!willSave().length}
                  loading={saving()}
                  onClick={() => void save()}
                >
                  Save {willSave().length} memories
                </Button>
              </div>
            </>
          )}
        </Show>
        <Show when={status()}>{(m) => <p role="status">{m()}</p>}</Show>
      </Show>
    </section>
  );
}
