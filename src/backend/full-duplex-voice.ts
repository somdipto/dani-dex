export type DuplexVoicePhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";

export type DuplexVoiceEvent =
  | { type: "phase"; phase: DuplexVoicePhase; turnId: number }
  | { type: "transcript"; text: string; turnId: number }
  | { type: "answer"; text: string; turnId: number }
  | { type: "audio"; audio: Uint8Array; turnId: number }
  | { type: "interrupted"; turnId: number }
  | { type: "error"; message: string; turnId: number };

export interface FullDuplexVoicePorts {
  transcribe(audio: Uint8Array, signal: AbortSignal): Promise<string>;
  dispatch(text: string, signal: AbortSignal): Promise<string>;
  synthesize(text: string, signal: AbortSignal): Promise<Uint8Array>;
}

/**
 * One duplex coordinator shared by local and Realtime transports. It guarantees that an older STT,
 * agent, or TTS completion cannot speak after barge-in has started a newer turn.
 */
export class FullDuplexVoiceSession {
  #turnId = 0;
  #phase: DuplexVoicePhase = "idle";
  #active: AbortController | null = null;

  constructor(private readonly ports: FullDuplexVoicePorts) {}

  get phase(): DuplexVoicePhase { return this.#phase; }

  listen(): DuplexVoiceEvent {
    this.#interrupt();
    const turnId = ++this.#turnId;
    this.#phase = "listening";
    return { type: "phase", phase: "listening", turnId };
  }

  async *commit(audio: Uint8Array): AsyncGenerator<DuplexVoiceEvent> {
    if (this.#phase !== "listening") throw new Error("Voice input is not listening.");
    const turnId = this.#turnId;
    const active = new AbortController();
    this.#active = active;
    try {
      this.#phase = "transcribing";
      yield { type: "phase", phase: "transcribing", turnId };
      const transcript = (await this.ports.transcribe(audio, active.signal)).trim();
      this.#assertCurrent(turnId, active);
      if (!transcript) throw new Error("No speech was detected.");
      yield { type: "transcript", text: transcript, turnId };

      this.#phase = "thinking";
      yield { type: "phase", phase: "thinking", turnId };
      const answer = (await this.ports.dispatch(transcript, active.signal)).trim();
      this.#assertCurrent(turnId, active);
      yield { type: "answer", text: answer, turnId };

      this.#phase = "speaking";
      yield { type: "phase", phase: "speaking", turnId };
      const spoken = await this.ports.synthesize(answer, active.signal);
      this.#assertCurrent(turnId, active);
      yield { type: "audio", audio: spoken, turnId };
      this.#phase = "idle";
      yield { type: "phase", phase: "idle", turnId };
    } catch (error) {
      if (active.signal.aborted || turnId !== this.#turnId) {
        yield { type: "interrupted", turnId };
        return;
      }
      this.#phase = "error";
      yield { type: "error", message: error instanceof Error ? error.message : "Voice call failed.", turnId };
    } finally {
      if (this.#active === active) this.#active = null;
    }
  }

  stop(): DuplexVoiceEvent | null {
    const turnId = this.#turnId;
    if (this.#phase === "idle") return null;
    this.#interrupt();
    this.#phase = "idle";
    return { type: "interrupted", turnId };
  }

  #interrupt(): void {
    this.#active?.abort();
    this.#active = null;
  }

  #assertCurrent(turnId: number, active: AbortController): void {
    if (active.signal.aborted || turnId !== this.#turnId) throw new DOMException("Interrupted", "AbortError");
  }
}
