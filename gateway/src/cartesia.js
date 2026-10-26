// Cartesia Line: managed realtime voice agent (full duplex, interruptions,
// turn-taking handled by Cartesia). This module provisions and manages the
// agent + phone number through the REST API, and speaks the Agents
// WebSocket protocol for live audio streams.
// Key comes from a file, never the environment or source.
const API = "https://api.cartesia.ai";
const VERSION = "2026-08-14";

export class Cartesia {
  constructor({ apiKey, fetchImpl } = {}) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl ?? fetch;
  }
  async #req(method, path, body) {
    const res = await this.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Cartesia-Version": VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`cartesia ${method} ${path}: ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  }
  // Idempotent: finds an existing agent by name and updates it, else creates.
  async ensureAgent({ name, instructions, initialMessage, voiceId, model, webhookTools = [] }) {
    const config = {
      instructions,
      initial_message: initialMessage,
      audio: { output: { voice_id: voiceId } },
      speculative_generation: true,
      prompt_optimization: true,
      tools: webhookTools,
      turn: { inactivity_check_in_secs: 32, inactivity_end_call_secs: 130 },
    };
    // Updates keep the agent's current model. New agents use the model the
    // operator names (CARTESIA_AGENT_MODEL), else the first one the account offers.
    const existing = await this.#req("GET", "/v1/agents");
    const found = (existing.data ?? []).find((a) => a.name === name);
    if (found) {
      await this.#req("PATCH", `/v1/agents/${found.id ?? found.agent_id}`, { config, description: "Dani voice agent" });
      return found.id ?? found.agent_id;
    }
    const modelId = model ?? (await this.listModels())[0];
    if (!modelId) throw new Error("no managed model available on this Cartesia account");
    config.model = { id: modelId, fallback_strategy: { type: "auto" } };
    const created = await this.#req("POST", "/v1/agents", { name, description: "Dani voice agent", config });
    return created.id ?? created.agent_id;
  }
  async listModels() {
    const data = await this.#req("GET", "/v1/agents/models");
    return (data.data ?? []).map((m) => m.id);
  }
  async listPhoneNumbers() {
    const data = await this.#req("GET", "/agents/phone-numbers");
    return data.data ?? [];
  }
  async assignNumber(phoneNumberId, agentId) {
    await this.#req("PATCH", `/agents/phone-numbers/${phoneNumberId}`, { agent_id: agentId });
  }
  // Server-side streams can use the API key directly; access tokens are
  // only needed for browser/mobile clients.
  async accessToken(agentId) {
    const data = await this.#req("POST", "/access-token", { grants: { agent: true }, expires_in: 300 });
    return data.token ?? data.access_token;
  }
  // Cartesia-provisioned US numbers cannot place outbound international
  // calls - inbound only. (Docs: telephony/phone-numbers feature table.)
}
