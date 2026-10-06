import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import { createSignal, For, Show } from "solid-js";
import { Button, Textarea } from "../../components/ui";
import { errorMessage } from "../../error-message";
import { PROVIDER_LOGOS } from "./provider-logos";

type Provider = "ChatGPT" | "Claude";

const PROMPT =
  "Export only what you can actually access from this chat's memory/context - do not infer or invent. Say when context is unavailable or incomplete. Exclude credentials, payment details, medical info, and private third-party details. Return discrete facts and preferences, each with its source and your uncertainty, as a simple list.";

const SECRET =
  /(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._-]{16,}|(?:access_token|refresh_token|api[_-]?key|secret|password)\s*[:=]\s*\S+|\b(?:\d[ -]?){13,19}\b)/gi;

interface Entry {
  id: number;
  text: string;
  keep: boolean;
  redacted: boolean;
}

function redact(raw: string): { text: string; redacted: boolean } {
  const noKeys = raw.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    "[private key removed]",
  );
  const text = noKeys.replace(SECRET, "[removed]");
  return { text, redacted: text !== raw };
}

function parse(raw: string, provider: Provider): Entry[] {
  const out: Entry[] = [];
  const clean = redact(raw);
  for (const line of clean.text.split(/\r?\n/)) {
    const body = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (body.length < 4 || /^#+\s/.test(body) || /^[A-Za-z ]+:$/.test(body)) continue;
    out.push({
      id: out.length,
      text: `Imported from ${provider} (historical): ${body}`,
      keep: true,
      redacted: body.includes("[removed]") || body.includes("[private key removed]"),
    });
  }
  return out;
}

export function ContextImportPanel(props: {
  room: number;
  limit: number;
  onSave: (texts: string[]) => Promise<void>;
  doneLabel: (n: number) => string;
}) {
  const [open, setOpen] = createSignal(false);
  const [provider, setProvider] = createSignal<Provider | null>(null);
  const [pasted, setPasted] = createSignal("");
  const [entries, setEntries] = createSignal<Entry[] | null>(null);
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
    setStatus(null);
  }
  /** Opens the provider with the prompt prefilled (the page may ignore it), and copies it as the fallback. */
  function start(name: Provider) {
    setProvider(name);
    void navigator.clipboard?.writeText(PROMPT).catch(() => undefined);
    void window.danidex.openExternal(name === "ChatGPT" ? "import-chatgpt" : "import-claude").catch(() => undefined);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus("Could not copy. Select the prompt text and copy it by hand.");
    }
  }
  function preview() {
    const p = provider();
    if (!p || !pasted().trim()) return;
    const list = parse(pasted(), p);
    setEntries(list);
    setStatus(list.length ? null : "Nothing usable found in what you pasted.");
  }
  function setText(id: number, text: string) {
    setEntries((list) => (list ?? []).map((e) => (e.id === id ? { ...e, text } : e)));
  }
  function setKeep(id: number, keep: boolean) {
    setEntries((list) => (list ?? []).map((e) => (e.id === id ? { ...e, keep } : e)));
  }
  async function save() {
    const items = willSave();
    if (!items.length) return;
    setSaving(true);
    try {
      await props.onSave(items.map((item) => item.text.trim()));
      setStatus(props.doneLabel(items.length));
      setEntries(null);
      setPasted("");
      setProvider(null);
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
                  onClick={() => start(name)}
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
          <p>1. Copy this prompt and send it to {provider()}.</p>
          <p class="context-import-prompt">{PROMPT}</p>
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
