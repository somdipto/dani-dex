// Receipts: a task is "done" only with evidence the outside world produced (page text, message id, file hash).
// No evidence means the task stays "unverified", never "done". Counts of finished work come from receipts only.
const KINDS = new Set(["page_text", "message_id", "email_subject", "file_sha256", "url"]);
export function markDone(store, id, evidence) {
  const ok = evidence && KINDS.has(evidence.kind) && typeof evidence.value === "string" && evidence.value.trim().length >= 4;
  if (!ok) { store.update(id, { state: "unverified" }, "no receipt: not counted as done"); return { done: false, reason: "evidence required (kind + non-empty value)" }; }
  store.update(id, { state: "done", receipt: { kind: evidence.kind, value: evidence.value.trim().slice(0, 500), at: new Date().toISOString() } }, `done with receipt (${evidence.kind})`);
  return { done: true };
}
export const countReceipts = (store, since = 0) => [...store.tasks.values()].filter((t) => t.state === "done" && t.receipt && Date.parse(t.receipt.at) >= since).length;
// Tasks that claim an outside effect (apply, send, submit, book) finish through here. The answer must carry
// "SUBMITTED <exact confirmation text>" or "SENT <message id>" to count; "WALL ..." ends as blocked, not done.
export const EVIDENCE_KINDS = new Set(["apply", "submit", "send", "book"]);
export function finishTask(store, id, answer, toolsUsed) {
  const t = store.get(id); const text = String(answer ?? "");
  if (!t || !EVIDENCE_KINDS.has(t.kind)) { store.update(id, { state: "done", result: { answer, toolsUsed } }, "done"); return; }
  store.update(id, { result: { answer, toolsUsed } });
  const m = text.match(/\bSUBMITTED\b[:\s-]*(.+)/s) ?? null; const s = text.match(/\bSENT\b[:\s-]*(\S.+)/s);
  if (/\bWALL\b/.test(text) && !m) { store.update(id, { state: "blocked" }, "wall reported, not done"); return; }
  if (m) { markDone(store, id, { kind: "page_text", value: m[1] }); return; }
  if (s) { markDone(store, id, { kind: "message_id", value: s[1] }); return; }
  markDone(store, id, null);
}
