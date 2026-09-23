import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "../../data";
import { findFinalAgentReply, waitForAgentReply } from "./agent-reply";
import type { RealtimeTransportHandlers } from "./realtime-voice-transport";
import { VoiceCall, type VoiceCallEvent, type VoiceCallTransport } from "./voice-call";

const agent = (id: string, body: string, extra: Partial<AgentMessage> = {}): AgentMessage => ({
  id,
  author: "agent",
  body,
  time: "",
  ...extra,
});

describe("final agent reply", () => {
  it("waits for the turn to settle and reads the last new text message, never an old one", () => {
    const known = new Set(["old"]);
    const messages = [
      agent("old", "Earlier answer"),
      agent("t1", "Looking now", { kind: "thinking" }),
      agent("a1", "Done: booked for 7."),
    ];
    expect(findFinalAgentReply(messages, known, "turn-1")).toBeNull();
    expect(findFinalAgentReply([...messages, agent("s", "partial", { streaming: true })], known, null)).toBeNull();
    expect(findFinalAgentReply(messages, known, null)).toBe("Done: booked for 7.");
    expect(findFinalAgentReply([agent("old", "Earlier answer")], known, null)).toBeNull();
  });

  it("resolves once the reactive thread shows the finished reply", async () => {
    const [messages, setMessages] = createSignal<AgentMessage[]>([agent("old", "Earlier")]);
    const [turn, setTurn] = createSignal<string | null>(null);
    const reply = waitForAgentReply({ messages, activeTurnId: turn }, new Set(["old"]), new AbortController().signal);
    setTurn("turn-1");
    setMessages((current) => [...current, { id: "u1", author: "you", body: "hi", time: "" }]);
    setMessages((current) => [...current, agent("a1", "Hello there.")]);
    setTurn(null);
    await expect(reply).resolves.toBe("Hello there.");
  });

  it("rejects when the call interrupts the wait", async () => {
    const [messages] = createSignal<AgentMessage[]>([]);
    const [turn] = createSignal<string | null>("turn-1");
    const abort = new AbortController();
    const reply = waitForAgentReply({ messages, activeTurnId: turn }, new Set(), abort.signal);
    abort.abort();
    await expect(reply).rejects.toMatchObject({ name: "AbortError" });
  });
});

function fakeTransport() {
  let handlers: RealtimeTransportHandlers | undefined;
  const spoken: string[] = [];
  let finishSpeech: (() => void) | undefined;
  const transport: VoiceCallTransport = {
    start: vi.fn(async (next: RealtimeTransportHandlers) => {
      handlers = next;
    }),
    speak: vi.fn(
      (text: string, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          spoken.push(text);
          finishSpeech = resolve;
          signal.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError")));
        }),
    ),
    stop: vi.fn(),
  };
  return {
    transport,
    spoken,
    handlers: () => {
      if (!handlers) throw new Error("The call has not started.");
      return handlers;
    },
    finishSpeech: () => finishSpeech?.(),
  };
}

describe("voice call", () => {
  it("sends each utterance through the thread and speaks only the final answer, then listens again", async () => {
    const fake = fakeTransport();
    const events: VoiceCallEvent[] = [];
    const submit = vi.fn(async () => true);
    const call = new VoiceCall({
      transport: fake.transport,
      snapshotMessageIds: () => new Set(["m0"]),
      submit,
      waitForReply: async (known) => (known.has("m0") ? "It is sunny." : "wrong"),
      onEvent: (event) => events.push(event),
    });
    await call.start();
    fake.handlers().onTranscript("what's the weather");
    await vi.waitFor(() => expect(fake.spoken).toEqual(["It is sunny."]));
    expect(submit).toHaveBeenCalledWith("what's the weather");
    fake.finishSpeech();
    await vi.waitFor(() =>
      expect(events.filter((event) => event.type === "phase" && event.phase === "listening")).toHaveLength(2),
    );
    expect(events).toContainEqual({ type: "transcript", text: "what's the weather", turnId: 1 });
  });

  it("barge-in cuts off the spoken answer and starts a new turn", async () => {
    const fake = fakeTransport();
    const events: VoiceCallEvent[] = [];
    const call = new VoiceCall({
      transport: fake.transport,
      snapshotMessageIds: () => new Set(),
      submit: async () => true,
      waitForReply: async () => "A long answer",
      onEvent: (event) => events.push(event),
    });
    await call.start();
    fake.handlers().onTranscript("tell me a story");
    await vi.waitFor(() => expect(fake.spoken).toHaveLength(1));
    fake.handlers().onSpeechStarted();
    await vi.waitFor(() => expect(events).toContainEqual({ type: "interrupted", turnId: 1 }));
    expect(events).toContainEqual({ type: "phase", phase: "listening", turnId: 2 });
    expect(fake.spoken).toHaveLength(1);
  });

  it("reports an undelivered utterance and keeps the call open", async () => {
    const fake = fakeTransport();
    const events: VoiceCallEvent[] = [];
    const call = new VoiceCall({
      transport: fake.transport,
      snapshotMessageIds: () => new Set(),
      submit: async () => false,
      waitForReply: async () => "unused",
      onEvent: (event) => events.push(event),
    });
    await call.start();
    fake.handlers().onTranscript("hello");
    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true));
    expect(fake.spoken).toEqual([]);
    expect(call.running).toBe(true);
    call.stop();
    expect(fake.transport.stop).toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "ended" });
  });
});
