import { describe, expect, it, vi } from "vitest";
import { type RealtimeClientEvent, RealtimeVoiceTransport } from "./realtime-voice-transport";

class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = "connecting";
  sent: RealtimeClientEvent[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close = vi.fn();
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }
  server(event: object) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
  }
}

function setup() {
  const channel = new FakeChannel();
  const pc = {
    addEventListener: vi.fn(),
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ sdp: "v=0 offer" })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const track = { stop: vi.fn() };
  const microphone = { getAudioTracks: () => [track], getTracks: () => [track] };
  const fetchImpl = vi.fn(async () => new Response("v=0 answer", { status: 201 }));
  const transport = new RealtimeVoiceTransport({
    createSession: async () => ({ clientSecret: "ek_test_secret_value", expiresAt: 1, model: "gpt-realtime" }),
    getMicrophone: async () => microphone,
    createPeerConnection: () => pc,
    createAudioElement: () => ({ autoplay: false, srcObject: null }),
    fetch: fetchImpl,
  });
  return { transport, channel, pc, track, fetchImpl };
}

describe("Realtime voice transport", () => {
  it("connects with the short-lived secret and configures transcription without model replies", async () => {
    const { transport, channel, pc, fetchImpl } = setup();
    await transport.start({ onSpeechStarted: vi.fn(), onTranscript: vi.fn(), onError: vi.fn() });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: "v=0 offer",
      headers: { Authorization: "Bearer ek_test_secret_value", "Content-Type": "application/sdp" },
    });
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "v=0 answer" });
    channel.open();
    expect(channel.sent[0]).toMatchObject({
      type: "session.update",
      session: { audio: { input: { turn_detection: { type: "server_vad", create_response: false } } } },
    });
  });

  it("forwards speech start and finished transcripts", async () => {
    const { transport, channel } = setup();
    const onSpeechStarted = vi.fn();
    const onTranscript = vi.fn();
    await transport.start({ onSpeechStarted, onTranscript, onError: vi.fn() });
    channel.server({ type: "input_audio_buffer.speech_started" });
    channel.server({ type: "conversation.item.input_audio_transcription.completed", transcript: "hello there" });
    expect(onSpeechStarted).toHaveBeenCalledOnce();
    expect(onTranscript).toHaveBeenCalledWith("hello there");
  });

  it("speaks out of band, resolves when playback stops, and clears audio on interruption", async () => {
    const { transport, channel, track, pc } = setup();
    await transport.start({ onSpeechStarted: vi.fn(), onTranscript: vi.fn(), onError: vi.fn() });
    channel.open();
    const done = transport.speak("Booked for seven.", new AbortController().signal);
    expect(channel.sent.at(-1)).toMatchObject({
      type: "response.create",
      response: { conversation: "none", output_modalities: ["audio"] },
    });
    channel.server({ type: "response.created", response: { id: "resp_1" } });
    channel.server({ type: "output_audio_buffer.stopped", response_id: "resp_1" });
    await expect(done).resolves.toBeUndefined();

    const abort = new AbortController();
    const cut = transport.speak("A long story", abort.signal);
    abort.abort();
    await expect(cut).rejects.toMatchObject({ name: "AbortError" });
    expect(channel.sent.slice(-2).map((event) => event.type)).toEqual(["response.cancel", "output_audio_buffer.clear"]);

    transport.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
  });
});
