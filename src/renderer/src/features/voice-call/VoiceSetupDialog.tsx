import { CodexVoicePanel } from "./CodexVoicePanel";
import { createEffect, createSignal, Show } from "solid-js";
import { Button, Dialog, Input } from "../../components/ui";
export interface VoiceSetupDialogProps {
  open: boolean;
  localSupported: boolean;
  onClose: () => void;
  onLocalDictation: () => void;
  onOpenAiCall: () => void;
}
export function VoiceSetupDialog(props: VoiceSetupDialogProps) {
  const [view, setView] = createSignal<"choose" | "paid" | "experimental">("choose");
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [paidAccepted, setPaidAccepted] = createSignal(false);
  createEffect(
    () => props.open,
    () => {
      setView("choose");
      setPaidAccepted(false);
      setKey("");
      setError(null);
    },
  );
  async function start() {
    if (!paidAccepted() || busy()) return;
    setBusy(true);
    setError(null);
    try {
      if (key().trim()) {
        await window.danidex.voice.setRealtimeApiKey(key().trim());
        setKey("");
      }
      const state = await window.danidex.voice.getRealtimeApiKeyStatus();
      if (state !== "saved") throw new Error("Add a valid OpenAI API key first.");
      props.onOpenAiCall();
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not set up voice.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="provider-code-login-backdrop">
          <Dialog.Content class="provider-code-login-dialog voice-setup-dialog" as="section">
            <div class="voice-setup-heading">
              <Dialog.Title>{view() === "choose" ? "Use your voice" : view() === "paid" ? "Talk with your agent" : "Experimental voice"}</Dialog.Title>
              <Button variant="ghost" aria-label="Close voice setup" onClick={props.onClose} disabled={busy()}>Close</Button>
            </div>
            <Show when={view() === "choose"}>
              <Dialog.Description>Choose what you want to do.</Dialog.Description>
              <section class="voice-choice-card">
                <h3>Speak instead of typing</h3>
                <p>Your microphone turns speech into a message. Runs on this computer.</p>
                <Button variant="outline" disabled={!props.localSupported} onClick={() => { props.onLocalDictation(); props.onClose(); }}>Use dictation</Button>
                <Show when={!props.localSupported}><small>Not available in this Linux build.</small></Show>
              </section>
              <section class="voice-choice-card">
                <h3>Have a live conversation</h3>
                <p>Speak and hear replies. Uses paid OpenAI API usage, separate from your ChatGPT plan.</p>
                <Button variant="outline" onClick={() => setView("paid")}>Set up live conversation</Button>
              </section>
              <Button variant="ghost" onClick={() => setView("experimental")}>Experimental options</Button>
            </Show>
            <Show when={view() === "paid"}>
              <Dialog.Description>This call uses paid OpenAI API usage, not your ChatGPT subscription. You can end it at any time.</Dialog.Description>
              <Input aria-label="OpenAI voice API key" type="password" autocomplete="off" placeholder="OpenAI API key (or use saved key)" value={key()} onValueChange={setKey} disabled={busy()} />
              <label class="voice-setup-consent"><input type="checkbox" checked={paidAccepted()} onChange={(event) => setPaidAccepted(event.currentTarget.checked)} /> I agree to paid OpenAI API usage for this call.</label>
              <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
              <Button disabled={!paidAccepted() || busy()} onClick={() => void start()}>Start paid call</Button>
            </Show>
            <Show when={view() === "experimental"}>
              <Dialog.Description>This option is still being tested. It may not work with your account.</Dialog.Description>
              <CodexVoicePanel />
            </Show>
            <Show when={view() !== "choose"}><Button variant="ghost" onClick={() => { setView("choose"); setPaidAccepted(false); setError(null); }} disabled={busy()}>Back</Button></Show>

          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
