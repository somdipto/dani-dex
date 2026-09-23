import { type DuplexVoiceEvent, FullDuplexVoiceSession } from "@dani-dex/contracts/full-duplex-voice";
import type { RealtimeTransportHandlers } from "./realtime-voice-transport";

export interface VoiceCallTransport {
  start(handlers: RealtimeTransportHandlers): Promise<void>;
  speak(text: string, signal: AbortSignal): Promise<void>;
  stop(): void;
}

export type VoiceCallEvent = DuplexVoiceEvent | { type: "connecting" } | { type: "ended" };

export interface VoiceCallDeps {
  transport: VoiceCallTransport;
  /** Ids of every message in the thread right now, taken before the utterance is sent. */
  snapshotMessageIds: () => ReadonlySet<string>;
  /** Sends the transcript through the ordinary composer path; false when it was not delivered. */
  submit: (text: string) => Promise<boolean>;
  waitForReply: (knownIds: ReadonlySet<string>, signal: AbortSignal) => Promise<string>;
  onEvent: (event: VoiceCallEvent) => void;
}

/**
 * A hands-free call on one agent thread. Each utterance becomes an ordinary user message, the agent
 * works as it always does, and only its final answer is spoken. Talking over the answer (or over a
 * turn still in progress) interrupts it; the interrupted turn keeps running in the thread but is
 * never read out.
 */
export class VoiceCall {
  readonly #session: FullDuplexVoiceSession;
  #running = false;

  constructor(private readonly deps: VoiceCallDeps) {
    this.#session = new FullDuplexVoiceSession({
      transcribe: async () => {
        throw new Error("This call transcribes on the transport.");
      },
      dispatch: async (text, signal) => {
        const known = deps.snapshotMessageIds();
        if (!(await deps.submit(text))) throw new Error("Could not send what you said. Try again.");
        return deps.waitForReply(known, signal);
      },
      synthesize: async (text, signal) => {
        await deps.transport.speak(text, signal);
        return new Uint8Array();
      },
    });
  }

  get running(): boolean {
    return this.#running;
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.deps.onEvent({ type: "connecting" });
    try {
      await this.deps.transport.start({
        onSpeechStarted: () => {
          if (this.#running) this.deps.onEvent(this.#session.listen());
        },
        onTranscript: (text) => {
          if (!this.#running) return;
          if (this.#session.phase !== "listening") this.deps.onEvent(this.#session.listen());
          void this.#drain(this.#session.commitText(text));
        },
        onError: (message) => this.deps.onEvent({ type: "error", message, turnId: -1 }),
      });
    } catch (error) {
      this.#running = false;
      this.deps.transport.stop();
      throw error;
    }
    if (this.#running) this.deps.onEvent(this.#session.listen());
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    const interrupted = this.#session.stop();
    if (interrupted) this.deps.onEvent(interrupted);
    this.deps.transport.stop();
    this.deps.onEvent({ type: "ended" });
  }

  async #drain(events: AsyncGenerator<DuplexVoiceEvent>): Promise<void> {
    for await (const event of events) {
      if (!this.#running) return;
      this.deps.onEvent(event);
    }
    // After an answer is spoken the call keeps listening for the next utterance.
    if (this.#running && (this.#session.phase === "idle" || this.#session.phase === "error")) {
      this.deps.onEvent(this.#session.listen());
    }
  }
}
