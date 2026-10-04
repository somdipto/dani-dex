import { ProviderLogo } from "@dani-dex/brand";
import { createSignal, createUniqueId, onCleanup, Show } from "solid-js";
import { Button, Checkbox } from "../../components/ui";
/** Experimental official Codex WebRTC route, separate from SIWC text and API-key voice. */
export function CodexVoicePanel(props: { ready: boolean }) {
  const consentId = createUniqueId();
  const [accepted, setAccepted] = createSignal(false);
  const [state, setState] = createSignal("Not connected");
  const [signedIn, setSignedIn] = createSignal(false);
  const [live, setLive] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let peer: RTCPeerConnection | null = null;
  let stream: MediaStream | null = null;
  let audio: HTMLAudioElement | null = null;
  let generation = 0;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  async function end() {
    generation++;
    if (deadline) clearTimeout(deadline);
    deadline = null;
    peer?.close();
    peer = null;
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    stream = null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio = null;
    }
    await window.danidex.voice.codexStop().catch(() => undefined);
    setAccepted(false);
    setLive(false);
    setState("Ended");
    setBusy(false);
  }
  onCleanup(() => {
    void end();
  });
  async function connect() {
    if (!props.ready || busy()) return;
    const current = ++generation;
    setSignedIn(false);
    setBusy(true);
    try {
      await window.danidex.voice.codexConnect();
      if (current !== generation) return;
      setState("Finish OpenAI sign-in in your browser, then check sign-in here.");
    } catch (error) {
      if (current === generation) setState(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  async function checkSignIn() {
    if (!props.ready || busy()) return;
    const current = ++generation;
    setBusy(true);
    try {
      const result = await window.danidex.voice.codexStatus();
      if (current !== generation) return;
      setSignedIn(result.connected);
      setState(
        result.connected
          ? "OpenAI sign-in confirmed. Approve one call to continue."
          : "OpenAI sign-in is not complete. Finish it in your browser, then check again.",
      );
    } catch (error) {
      if (current === generation) {
        setSignedIn(false);
        setState(error instanceof Error ? error.message : "Could not check sign-in.");
      }
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  async function start() {
    if (!props.ready || !signedIn() || !accepted() || busy()) return;
    const current = ++generation;
    setBusy(true);
    setState("Connecting...");
    try {
      if (!(await window.danidex.voice.codexStatus()).connected) {
        setSignedIn(false);
        throw new Error("OpenAI sign-in expired. Sign in again before a call.");
      }
      if (current !== generation) return;
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation) {
        microphone.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      stream = microphone;
      peer = new RTCPeerConnection();
      const activePeer = peer;
      deadline = setTimeout(() => {
        if (current === generation) void end().then(() => setState("Audio connection timed out."));
      }, 30_000);
      peer.onconnectionstatechange = () => {
        if (current !== generation) return;
        if (activePeer.connectionState === "connected") {
          if (deadline) clearTimeout(deadline);
          deadline = null;
          setLive(true);
          setState("Live experimental call");
        }
        if (["failed", "closed", "disconnected"].includes(activePeer.connectionState)) void end();
      };
      audio = new Audio();
      audio.autoplay = true;
      peer.ontrack = (event) => {
        if (audio) audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      };
      for (const track of stream.getTracks()) peer.addTrack(track, stream);
      peer.createDataChannel("oai-events");
      await peer.setLocalDescription(await peer.createOffer());
      const offer = peer.localDescription?.sdp;
      if (!offer) throw new Error("Could not create an audio offer.");
      const answer = await window.danidex.voice.codexStart({ sdp: offer, consent: accepted() });
      if (current !== generation || !peer) return;
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      setState("Connecting audio...");
    } catch (error) {
      if (current !== generation) return;
      const message = error instanceof Error ? error.message : "Call failed.";
      await end();
      setState(message);
    } finally {
      if (current === generation) setBusy(false);
    }
  }
  return (
    <section class="voice-setup-option">
      <h3 class="voice-auth-brand">
        <ProviderLogo provider="codex" /> Experimental ChatGPT plan voice
      </h3>
      <p>
        Uses Codex's own ChatGPT login, not the text sign-in above. Eligibility and backend availability are not
        guaranteed. This may consume plan quota. No API-key fallback.
      </p>
      <p role="status">{state()}</p>
      <label for={consentId}>
        <Checkbox id={consentId} checked={accepted()} onChange={(event) => setAccepted(event.currentTarget.checked)} />{" "}
        I approve one experimental call using my ChatGPT plan quota.
      </label>
      <div class="voice-setup-actions">
        <Button variant="outline" disabled={!props.ready || busy()} onClick={() => void connect()}>
          <ProviderLogo provider="codex" class="voice-auth-button-logo" /> Sign in with OpenAI
        </Button>
        <Button variant="outline" disabled={!props.ready || busy()} onClick={() => void checkSignIn()}>
          Check OpenAI sign-in
        </Button>
        <Button disabled={!props.ready || !signedIn() || !accepted() || busy()} onClick={() => void start()}>
          Start experimental call
        </Button>
        <Show when={busy() || live()}>
          <Button variant="outline" onClick={() => void end()}>
            End experimental call
          </Button>
        </Show>
      </div>
    </section>
  );
}
