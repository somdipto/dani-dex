import { Cartesia } from "./cartesia.js";
import { canUseCartesiaVoice } from "./plan.js";

// Full-duplex voice session against the hosted Dani Line agent.
// Audio in/out are raw PCM chunks (base64 on the wire). Barge-in: the
// server sends `clear`, which we surface so the player drops its buffer.
export class VoiceSession {
  constructor({ cartesia, agentId, plan, WS = globalThis.WebSocket, inputFormat = "pcm_16000" }) {
    this.cartesia = cartesia; this.agentId = agentId; this.plan = plan; this.WS = WS; this.inputFormat = inputFormat;
    this.handlers = { audio: () => {}, clear: () => {}, close: () => {}, ack: () => {} };
    this.ws = null; this.callId = null;
  }
  on(evt, fn) { this.handlers[evt] = fn; return this; }
  async start() {
    if (!canUseCartesiaVoice(this.plan)) throw new Error("cartesia voice is not enabled on this plan");
    const token = await this.cartesia.accessToken(this.agentId);
    const url = `wss://api.cartesia.ai/v1/agents/websocket/${this.agentId}?cartesia_version=2026-08-14&access_token=${encodeURIComponent(token)}`;
    await new Promise((resolve, reject) => {
      this.ws = new this.WS(url);
      this.ws.onopen = () => this.ws.send(JSON.stringify({ type: "session_create", audio: { input_format: this.inputFormat, output_delivery: "as_available" } }));
      this.ws.onerror = () => reject(new Error("voice socket error"));
      this.ws.onclose = () => this.handlers.close();
      this.ws.onmessage = (m) => {
        const e = JSON.parse(typeof m.data === "string" ? m.data : Buffer.from(m.data).toString());
        if (e.type === "session_ready") { this.callId = e.call_id; this.handlers.ack(e); resolve(); }
        else if (e.type === "audio_output") this.handlers.audio(Buffer.from(e.audio, "base64"));
        else if (e.type === "audio_output_clear") this.handlers.clear();
      };
    });
    return this;
  }
  sendAudio(buf) {
    this.ws?.send(JSON.stringify({ type: "audio_input", audio: Buffer.from(buf).toString("base64") }));
  }
  close() { try { this.ws?.close(); } catch {} }
}
