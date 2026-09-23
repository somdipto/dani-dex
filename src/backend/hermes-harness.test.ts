import { describe, expect, it } from "vitest";
import { decodeHermesEvent } from "./hermes-harness";

describe("Hermes harness protocol", () => {
  it("maps the upstream stream-json lifecycle without scraping terminal output", () => {
    expect(decodeHermesEvent('{"type":"system","subtype":"init","model":"openai/gpt","session_id":"s-1"}')).toEqual({
      type: "started", sessionId: "s-1", model: "openai/gpt",
    });
    expect(decodeHermesEvent('{"type":"text","text":"hello"}')).toEqual({ type: "text", text: "hello" });
    expect(decodeHermesEvent('{"type":"tool_use","name":"terminal","tool_call_id":"c-1","input":{"cmd":"pwd"}}')).toEqual({
      type: "tool-started", name: "terminal", callId: "c-1", input: { cmd: "pwd" },
    });
    expect(decodeHermesEvent('{"type":"tool_result","name":"terminal","tool_call_id":"c-1","output":"/tmp","is_error":false}')).toEqual({
      type: "tool-finished", name: "terminal", callId: "c-1", output: "/tmp", failed: false,
    });
    expect(decodeHermesEvent('{"type":"result","session_id":"s-1","exit_code":0,"text":"done"}')).toEqual({
      type: "finished", sessionId: "s-1", exitCode: 0, text: "done",
    });
  });

  it("ignores future events but rejects a broken JSON stream", () => {
    expect(decodeHermesEvent('{"type":"reasoning","text":"private"}')).toBeNull();
    expect(() => decodeHermesEvent("not json")).toThrow("Hermes emitted invalid JSONL.");
  });
});
