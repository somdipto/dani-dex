import test from "node:test";
import assert from "node:assert/strict";
import { TaskStore } from "../src/store.js";
import { markDone, countReceipts } from "../src/receipts.js";
import { Approvals } from "../src/approvals.js";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "dd-"));
test("no evidence is never done", () => {
  const s = new TaskStore(join(dir, "t.jsonl")); const id = s.create("apply", {});
  assert.equal(markDone(s, id, null).done, false); assert.equal(s.get(id).state, "unverified");
  assert.equal(markDone(s, id, { kind: "page_text", value: " " }).done, false);
  assert.equal(countReceipts(s), 0);
  assert.equal(markDone(s, id, { kind: "page_text", value: "Thank You! We'll be in touch" }).done, true);
  assert.equal(countReceipts(s), 1);
});
test("approval binds recipient and words; grants are owner-only and narrow", () => {
  const a = new Approvals(join(dir, "a.jsonl")); const id = a.request({ recipient: "x@y.com", words: "Hi" });
  assert.equal(a.canSend({ id, recipient: "x@y.com", words: "Hi" }).ok, false);
  assert.equal(a.approve(id, "agent"), false); assert.equal(a.approve(id, "owner"), true);
  assert.equal(a.canSend({ id, recipient: "x@y.com", words: "Hi" }).ok, true);
  assert.equal(a.canSend({ id, recipient: "z@y.com", words: "Hi" }).ok, false);
  assert.equal(a.canSend({ id, recipient: "x@y.com", words: "Hi there" }).ok, false);
  assert.equal(a.grant({ recipient: "x@y.com", kind: "reminder", by: "agent" }), false);
  a.grant({ recipient: "x@y.com", kind: "reminder", by: "owner" });
  assert.equal(a.canSend({ recipient: "x@y.com", words: "any", kind: "reminder" }).ok, true);
  assert.equal(a.canSend({ recipient: "x@y.com", words: "any", kind: "invoice" }).ok, false);
  assert.equal(new Approvals(join(dir, "a.jsonl")).canSend({ recipient: "x@y.com", words: "any", kind: "reminder" }).ok, true);
});
import { finishTask } from "../src/receipts.js";
test("apply task needs a receipt; walls are blocked; plain tasks unaffected", () => {
  const s = new TaskStore(join(dir, "f.jsonl"));
  const a = s.create("apply", {}); finishTask(s, a, "Dani: X - SUBMITTED Thank You! We'll be in touch", []); assert.equal(s.get(a).state, "done");
  const b = s.create("apply", {}); finishTask(s, b, "I filled the form and it looks good", []); assert.equal(s.get(b).state, "unverified");
  const c = s.create("apply", {}); finishTask(s, c, "Dani: X - WALL: Registrations Paused", []); assert.equal(s.get(c).state, "blocked");
  const d = s.create("chat", {}); finishTask(s, d, "hello", []); assert.equal(s.get(d).state, "done");
});
