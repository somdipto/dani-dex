import { describe, expect, it, vi } from "vitest";
import { FullDuplexVoiceSession } from "./full-duplex-voice";

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("full-duplex voice session", () => {
  it("routes speech through the ordinary agent dispatch before speaking", async () => {
    const calls: string[] = [];
    const session = new FullDuplexVoiceSession({
      transcribe: async () => { calls.push("stt"); return "book the table"; },
      dispatch: async (text) => { calls.push(`agent:${text}`); return "Booked for seven."; },
      synthesize: async (text) => { calls.push(`tts:${text}`); return Uint8Array.of(1, 2); },
    });
    expect(session.listen()).toMatchObject({ phase: "listening", turnId: 1 });
    const events = await collect(session.commit(Uint8Array.of(9)));
    expect(calls).toEqual(["stt", "agent:book the table", "tts:Booked for seven."]);
    expect(events.map(({ type }) => type)).toEqual([
      "phase", "transcript", "phase", "answer", "phase", "audio", "phase",
    ]);
    expect(session.phase).toBe("idle");
  });

  it("aborts an old agent turn on barge-in and never synthesizes its late answer", async () => {
    let finish: ((value: string) => void) | undefined;
    const dispatch = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const synthesize = vi.fn(async () => Uint8Array.of(1));
    const session = new FullDuplexVoiceSession({ transcribe: async () => "first", dispatch, synthesize });
    session.listen();
    const running = collect(session.commit(Uint8Array.of(1)));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    expect(session.listen()).toMatchObject({ phase: "listening", turnId: 2 });
    finish?.("late answer");
    expect(await running).toContainEqual({ type: "interrupted", turnId: 1 });
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("reports stage failures without hiding recovery behind a busy phase", async () => {
    const session = new FullDuplexVoiceSession({
      transcribe: async () => { throw new Error("Realtime session expired."); },
      dispatch: async () => "unused",
      synthesize: async () => new Uint8Array(),
    });
    session.listen();
    expect(await collect(session.commit(Uint8Array.of(1)))).toContainEqual({
      type: "error", message: "Realtime session expired.", turnId: 1,
    });
    expect(session.phase).toBe("error");
    expect(session.listen()).toMatchObject({ phase: "listening", turnId: 2 });
  });
});
