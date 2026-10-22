// Re-prompts idle OpenCode sessions that died on a transient model error, until the agent gives a final answer.
// usage: node scripts/session-keepalive.mjs <sessionId>... ; env OPENCODE_URL (default http://127.0.0.1:4199), MAX_NUDGES (default 40), MODEL_ID/PROVIDER_ID to pin a model
const base = process.env.OPENCODE_URL ?? "http://127.0.0.1:4199";
const max = Number(process.env.MAX_NUDGES ?? 40);
const j = async (p, o) => { const r = await fetch(base + p, o); return r.status === 204 ? null : r.json(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function keep(id) {
  for (let n = 0; n < max;) {
    await sleep(20000);
    const st = (await j("/session/status"))?.[id];
    if (st) continue;
    const msgs = await j(`/session/${id}/message`);
    const last = msgs.at(-1);
    const text = msgs.filter((m) => m.info.role === "assistant").flatMap((m) => m.parts).filter((p) => p.type === "text" && p.text.trim()).at(-1)?.text ?? "";
    const final = last?.info.role === "assistant" && !last.info.error && /confirmation|submitted|wall|released|blocked/i.test(text);
    if (final) { console.log(id, "done:", text.slice(0, 1200)); return; }
    n++;
    await j(`/session/${id}/prompt_async`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(process.env.MODEL_ID ? { model: { providerID: process.env.PROVIDER_ID ?? "opencode", modelID: process.env.MODEL_ID } } : {}), parts: [{ type: "text", text: "Continue the application from where you stopped (same app name). Re-read the page first. Finish and submit, then reply with the exact confirmation text or the exact wall." }] }) });
    console.log(id, "nudge", n);
  }
}
await Promise.all(process.argv.slice(2).map(keep));
