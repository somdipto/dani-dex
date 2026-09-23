import type { RealtimeVoiceSession } from "@dani-dex/contracts/ipc";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export interface RealtimeTransportHandlers {
  /** The caller started talking: barge-in. */
  onSpeechStarted: () => void;
  /** A finished utterance transcript. */
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}

/** The parts of the browser WebRTC and media objects this transport touches. */
export interface RealtimeTrack {
  stop(): void;
}

export interface RealtimeMicrophone {
  getAudioTracks(): RealtimeTrack[];
  getTracks(): RealtimeTrack[];
}

export interface RealtimeChannel {
  readonly readyState: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message", listener: (event: Event & { data?: unknown }) => void): void;
}

export interface RealtimePeer {
  addEventListener(type: "track", listener: (event: { streams: readonly MediaStream[] }) => void): void;
  addTrack(track: RealtimeTrack, stream: RealtimeMicrophone): unknown;
  createDataChannel(label: string): RealtimeChannel;
  createOffer(): Promise<{ sdp?: string }>;
  setLocalDescription(description: { sdp?: string }): Promise<void>;
  setRemoteDescription(description: { type: "answer"; sdp: string }): Promise<void>;
  close(): void;
}

export interface RealtimeAudioOutput {
  autoplay: boolean;
  srcObject: unknown;
}

export type RealtimeClientEvent =
  | { type: "session.update"; session: Record<"type" | "instructions", string> & { audio: RealtimeAudioConfig } }
  | { type: "response.create"; response: { conversation: "none"; output_modalities: ["audio"]; instructions: string } }
  | { type: "response.cancel" }
  | { type: "output_audio_buffer.clear" };

interface RealtimeAudioConfig {
  input: {
    transcription: { model: string };
    turn_detection: { type: "server_vad"; create_response: boolean; interrupt_response: boolean };
  };
  output: { voice: string };
}

export interface RealtimeTransportDeps {
  createSession: () => Promise<RealtimeVoiceSession>;
  getMicrophone: () => Promise<RealtimeMicrophone>;
  createPeerConnection: () => RealtimePeer;
  createAudioElement: () => RealtimeAudioOutput;
  fetch: (
    url: string,
    init: { method: "POST"; body: string; headers: Record<"Authorization" | "Content-Type", string> },
  ) => Promise<{ ok: boolean; text(): Promise<string> }>;
}

/**
 * Speech in and speech out over one OpenAI Realtime WebRTC call. The model never answers on its
 * own (`create_response: false`): transcripts go to the ordinary agent thread, and `speak` asks it
 * to read the agent's final answer verbatim as an out-of-band response.
 */
export class RealtimeVoiceTransport {
  #pc: RealtimePeer | null = null;
  #channel: RealtimeChannel | null = null;
  #microphone: RealtimeMicrophone | null = null;
  #audio: RealtimeAudioOutput | null = null;
  #speaking: { responseId: string | null; resolve: () => void; reject: (error: unknown) => void } | null = null;

  constructor(private readonly deps: RealtimeTransportDeps) {}

  async start(handlers: RealtimeTransportHandlers): Promise<void> {
    const session = await this.deps.createSession();
    const microphone = await this.deps.getMicrophone();
    const pc = this.deps.createPeerConnection();
    const audio = this.deps.createAudioElement();
    audio.autoplay = true;
    this.#pc = pc;
    this.#microphone = microphone;
    this.#audio = audio;
    pc.addEventListener("track", (event) => {
      audio.srcObject = event.streams[0] ?? null;
    });
    for (const track of microphone.getAudioTracks()) pc.addTrack(track, microphone);
    const channel = pc.createDataChannel("oai-events");
    this.#channel = channel;
    channel.addEventListener("open", () => this.#send(sessionUpdate()));
    channel.addEventListener("message", (event) => this.#handleServerEvent(event.data, handlers));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await this.deps.fetch(REALTIME_CALLS_URL, {
      method: "POST",
      body: offer.sdp ?? "",
      headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
    });
    if (!response.ok) {
      this.stop();
      throw new Error("Realtime voice could not connect.");
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await response.text() });
  }

  /** Reads `text` aloud and resolves when playback stops; aborting cuts the audio off at once. */
  speak(text: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException("Interrupted", "AbortError"));
    this.#cancelSpeech();
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        this.#cancelSpeech();
        reject(new DOMException("Interrupted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#speaking = {
        responseId: null,
        resolve: () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
        reject: (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
      this.#send({
        type: "response.create",
        response: {
          conversation: "none",
          output_modalities: ["audio"],
          instructions: `Read the following text aloud exactly as written. Do not add, remove, or change anything.\n\n${text}`,
        },
      });
    });
  }

  stop(): void {
    this.#cancelSpeech();
    this.#channel?.close();
    this.#pc?.close();
    for (const track of this.#microphone?.getTracks() ?? []) track.stop();
    if (this.#audio) this.#audio.srcObject = null;
    this.#channel = null;
    this.#pc = null;
    this.#microphone = null;
    this.#audio = null;
  }

  #cancelSpeech(): void {
    const speaking = this.#speaking;
    if (!speaking) return;
    this.#speaking = null;
    this.#send({ type: "response.cancel" });
    this.#send({ type: "output_audio_buffer.clear" });
    speaking.reject(new DOMException("Interrupted", "AbortError"));
  }

  #send(event: RealtimeClientEvent): void {
    if (this.#channel?.readyState === "open") this.#channel.send(JSON.stringify(event));
  }

  #handleServerEvent(data: unknown, handlers: RealtimeTransportHandlers): void {
    let event: {
      type?: unknown;
      transcript?: unknown;
      response?: { id?: unknown };
      response_id?: unknown;
      error?: { message?: unknown };
    };
    try {
      event = typeof data === "string" ? JSON.parse(data) : {};
    } catch {
      return;
    }
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        handlers.onSpeechStarted();
        return;
      case "conversation.item.input_audio_transcription.completed":
        if (typeof event.transcript === "string" && event.transcript.trim()) handlers.onTranscript(event.transcript);
        return;
      case "response.created":
        if (this.#speaking && typeof event.response?.id === "string") this.#speaking.responseId = event.response.id;
        return;
      case "output_audio_buffer.stopped": {
        const speaking = this.#speaking;
        if (!speaking) return;
        if (speaking.responseId && event.response_id !== speaking.responseId) return;
        this.#speaking = null;
        speaking.resolve();
        return;
      }
      case "error":
        handlers.onError(typeof event.error?.message === "string" ? event.error.message : "Realtime voice failed.");
        return;
      default:
        return;
    }
  }
}

function sessionUpdate(): RealtimeClientEvent {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions:
        "You are the voice of Dani-Dex. Never answer on your own. When asked, read the given text aloud verbatim.",
      audio: {
        input: {
          transcription: { model: "gpt-4o-transcribe" },
          turn_detection: { type: "server_vad", create_response: false, interrupt_response: true },
        },
        output: { voice: "marin" },
      },
    },
  };
}
