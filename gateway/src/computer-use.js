// Computer-use worker client: a dedicated brain that drives the real desktop
// through the pinned driver. Kept apart from the general executor so a casual
// chat never gets desktop tools by accident.
export class ComputerUseWorker {
  constructor({ baseUrl, fetchImpl } = {}) {
    this.baseUrl = baseUrl?.replace(/\/$/, "");
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.available = Boolean(baseUrl);
  }
  async healthy() {
    if (!this.available) return false;
    try {
      const res = await this.fetch(this.baseUrl + "/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) return false;
      const s = await res.json();
      await this.fetch(`${this.baseUrl}/session/${s.id ?? s.sessionID}`, { method: "DELETE" }).catch(() => {});
      return true;
    } catch { return false; }
  }
  async run(task, { timeoutMs = 10 * 60 * 1000, onTool } = {}) {
    if (!this.available) throw new Error("computer-use worker not connected");
    const prompt =
      "You operate the user's real desktop through the computer-use tools. " +
      "Do exactly what the task asks, verify the result with the tools (do not claim success you did not verify), " +
      "and report back in one or two plain sentences. " +
      "To open a web page, launch google-chrome with the URL as its argument; if a browser_navigate call fails once, do not retry it - read the page from the window instead. Stop after at most 15 tool calls and report what you saw. Task: " + task;
    const api = async (path, body) => {
      const res = await this.fetch(this.baseUrl + path, {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`worker ${path}: ${res.status}`);
      return res.json();
    };
    const session = await api("/session", {});
    const sid = session.id ?? session.sessionID;
    try {
      // prompt_async returns at once; the sync /message route blocks until the whole run ends, which defeats the deadline and tool counting
      await this.fetch(`${this.baseUrl}/session/${sid}/prompt_async`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parts: [{ type: "text", text: prompt }] }) }).then((r) => { if (!r.ok) throw new Error(`worker prompt_async: ${r.status}`); });
      const deadline = Date.now() + timeoutMs;
      let answer = "";
      const toolsUsed = [];
      for (;;) {
        if (Date.now() > deadline) { await this.fetch(`${this.baseUrl}/session/${sid}/abort`, { method: "POST" }).catch(() => {}); throw new Error("computer-use task timed out"); }
        await new Promise((r) => setTimeout(r, 2000));
        const msgs = await api(`/session/${sid}/message`);
        const list = Array.isArray(msgs) ? msgs : msgs.messages ?? [];
        let busy = false;
        for (const m of list) {
          for (const p of m.parts ?? m.message?.parts ?? []) {
            if (p.type === "tool") {
              const name = p.tool ?? p.name ?? "tool";
              if (!toolsUsed.some((u) => u.id === (p.callID ?? p.id))) {
                toolsUsed.push({ id: p.callID ?? p.id, tool: name });
                onTool?.(name);
              }
              if (!["completed", "error"].includes(p.state?.status)) busy = true;
            }
            if (p.type === "text" && p.text) answer = p.text;
          }
        }
        const last = [...list].reverse().find((m) => ((m.info ?? m).role === "assistant"));
        const finish = last ? (last.info ?? last).finish : null;
        if (answer && !busy && finish && finish !== "tool-calls") break;
      }
      return { answer: answer || "(no answer)", toolsUsed };
    } finally {
      await this.fetch(`${this.baseUrl}/session/${sid}`, { method: "DELETE" }).catch(() => {});
    }
  }
}
