import { finishTask } from "./receipts.js";
// opencode serve executor: durable tasks (run) and direct conversation (chat).
export class OpenCodeExecutor {
  constructor({ baseUrl, memoryFile, memory }) {
    this.baseUrl = baseUrl?.replace(/\/$/, "");
    this.memory = memory;
    this.available = Boolean(baseUrl);
  }
  async #api(path, body) {
    const res = await fetch(this.baseUrl + path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`opencode ${path}: ${res.status}`);
    return res.json();
  }
  async #runPrompt(text, onTool) {
    const session = await this.#api("/session", {});
    const sid = session.id ?? session.sessionID;
    await this.#api(`/session/${sid}/message`, {
      parts: [{ type: "text", text: (this.memory?.prompt() ?? "") + text }],
    });
    const deadline = Date.now() + 10 * 60 * 1000;
    let answer = "";
    const toolsUsed = [];
    for (;;) {
      if (Date.now() > deadline) throw new Error("opencode turn timed out");
      await new Promise((r) => setTimeout(r, 2000));
      const msgs = await this.#api(`/session/${sid}/message`);
      const list = Array.isArray(msgs) ? msgs : msgs.messages ?? [];
      let busy = false;
      const failed = list.find((m) => (m.info ?? m).role === "assistant" && (m.info ?? m).error);
      if (failed) throw new Error(`agent runtime error: ${(failed.info ?? failed).error?.data?.statusCode ?? "unknown"}`);
      for (const m of list) {
        const parts = m.parts ?? m.message?.parts ?? [];
        for (const p of parts) {
          if (p.type === "tool") {
            const name = p.tool ?? p.name ?? "tool";
            if (!toolsUsed.some((u) => u.id === (p.callID ?? p.id))) {
              toolsUsed.push({ id: p.callID ?? p.id, tool: name, input: p.state?.input ?? {} });
              onTool?.(name);
            }
            if (!["completed", "error"].includes(p.state?.status)) busy = true;
          }
          if (p.type === "text" && p.text && (m.info ?? m).role === "assistant") answer = p.text;
        }
        if ((m.info ?? m).role === "assistant" && !((m.info ?? m).finish ?? "done")) busy = true;
      }
      const lastAssistant = [...list].reverse().find((m) => ((m.info ?? m).role === "assistant"));
      const finish = lastAssistant ? (lastAssistant.info ?? lastAssistant).finish : null;
      if (answer && !busy && finish) break;
      if (answer && !busy && list.length && (lastAssistant?.info ?? lastAssistant)?.time?.completed) break;
      if (answer && !busy && finish !== null) break;
    }
    await this.#api(`/session/${sid}`, undefined).catch(() => {});
    await fetch(`${this.baseUrl}/session/${sid}`, { method: "DELETE" }).catch(() => {});
    return { answer: answer || "(no answer)", toolsUsed };
  }
  async run(store, id) {
    const t = store.get(id);
    if (!t) return;
    store.update(id, { state: "running" }, "agent started");
    try {
      const { answer, toolsUsed } = await this.#runPrompt(t.input.task, (tool) =>
        store.log(id, `used ${tool}`),
      );
      finishTask(store, id, answer, toolsUsed);
    } catch (err) {
      store.update(id, { state: "failed", error: String(err?.message ?? err) }, "failed");
    }
  }
  async chat(text) {
    const { answer } = await this.#runPrompt(text);
    return answer;
  }
}
