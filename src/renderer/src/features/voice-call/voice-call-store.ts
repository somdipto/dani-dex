import { createEffect, createSignal, onCleanup } from "solid-js";
import type { AgentMessage } from "../../data";
import { errorMessage } from "../../error-message";
import { waitForAgentReply } from "./agent-reply";
import { RealtimeVoiceTransport } from "./realtime-voice-transport";
import { VoiceCall, type VoiceCallEvent, type VoiceCallTransport } from "./voice-call";

export type VoiceCallPhase = "off" | "connecting" | "listening" | "thinking" | "speaking";

export interface VoiceCallTarget {
  agentId: string;
  serverId: string;
}

export interface VoiceCallStoreDeps {
  target: () => VoiceCallTarget | undefined;
  messages: () => readonly AgentMessage[];
  activeTurnId: () => string | null | undefined;
  /** The ordinary composer submit: the transcript becomes a normal user message on the thread. */
  submit: (text: string, target: VoiceCallTarget) => Promise<boolean>;
  createTransport?: () => VoiceCallTransport;
}

export function createBrowserRealtimeTransport(): VoiceCallTransport {
  return new RealtimeVoiceTransport({
    createSession: () => window.danidex.voice.createRealtimeSession(),
    getMicrophone: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
    createPeerConnection: () => new RTCPeerConnection(),
    createAudioElement: () => new Audio(),
    fetch: (url, init) => fetch(url, init),
  });
}

export function createVoiceCallStore(deps: VoiceCallStoreDeps) {
  const [phase, setPhase] = createSignal<VoiceCallPhase>("off");
  const [error, setError] = createSignal<string | null>(null);
  const [heard, setHeard] = createSignal<string | null>(null);
  let call: VoiceCall | undefined;
  let callTarget: VoiceCallTarget | undefined;

  function handleEvent(event: VoiceCallEvent): void {
    switch (event.type) {
      case "connecting":
        setPhase("connecting");
        return;
      case "ended":
        setPhase("off");
        return;
      case "transcript":
        setHeard(event.text);
        return;
      case "error":
        setError(event.message);
        return;
      case "phase":
        if (event.phase === "listening") setPhase("listening");
        else if (event.phase === "thinking" || event.phase === "transcribing") setPhase("thinking");
        else if (event.phase === "speaking") setPhase("speaking");
        if (event.phase === "listening") setError(null);
        return;
      default:
        return;
    }
  }

  async function startCall(): Promise<void> {
    const target = deps.target();
    if (!target || call) return;
    setError(null);
    setHeard(null);
    callTarget = target;
    const current = new VoiceCall({
      transport: (deps.createTransport ?? createBrowserRealtimeTransport)(),
      snapshotMessageIds: () => new Set(deps.messages().map((message) => message.id)),
      submit: (text) => deps.submit(text, target),
      waitForReply: (known, signal) =>
        waitForAgentReply({ messages: deps.messages, activeTurnId: deps.activeTurnId }, known, signal),
      onEvent: handleEvent,
    });
    call = current;
    try {
      await current.start();
    } catch (failure) {
      if (call === current) call = undefined;
      callTarget = undefined;
      setPhase("off");
      setError(errorMessage(failure, "Could not start the voice call. Try again."));
    }
  }

  function endCall(): void {
    const current = call;
    call = undefined;
    callTarget = undefined;
    current?.stop();
    setPhase("off");
  }

  // A call belongs to one thread: switching agents or servers hangs up rather than reading another
  // thread's replies aloud.
  createEffect(
    () => deps.target(),
    (target) => {
      if (callTarget && (target?.agentId !== callTarget.agentId || target?.serverId !== callTarget.serverId)) {
        endCall();
      }
    },
  );
  onCleanup(endCall);

  return { voiceCallPhase: phase, voiceCallError: error, voiceCallHeard: heard, startCall, endCall };
}

export type VoiceCallStore = ReturnType<typeof createVoiceCallStore>;
