import test from "node:test"; import assert from "node:assert/strict";
import { hintsForHost } from "../src/browser-local.mjs";
test("site memory matches host and subdomains only", () => {
  const m = { "denvr.com": ["a"] };
  assert.equal(hintsForHost("www.denvr.com", m).length, 1);
  assert.equal(hintsForHost("denvr.com", m).length, 1);
  assert.equal(hintsForHost("notdenvr.com", m).length, 0);
});
test("shipped memory file loads and matches a host", () => {
  assert.ok(hintsForHost("www.example.com").length >= 1);
});
import { readFileSync } from "node:fs";
test("frame hint is a tool instruction, never wall-like text", () => {
  const src = readFileSync(new URL("../src/browser-local.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("TOOL INSTRUCTION") && !src.includes("NOT shown above"));
});
test("every browser call has an overall deadline", () => {
  const src = readFileSync(new URL("../src/browser-local.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("CALL_DEADLINE_MS") && src.includes("Promise.race"));
});
