import { describe, expect, it } from "vitest";
import { loopCommandInstructions } from "./loop-command";

describe("bounded loop command", () => {
  it("does not change ordinary messages or command prefixes", () => {
    expect(loopCommandInstructions("hello")).toBeNull();
    expect(loopCommandInstructions("/loophole task")).toBeNull();
  });
  it("requires a task and keeps the iteration and approval gates", () => {
    expect(() => loopCommandInstructions("/loop")).toThrow("task");
    const text = loopCommandInstructions("/loop Fix search\nVerify restart");
    expect(text).toContain("after five cycles");
    expect(text).toContain("missing approval");
    expect(text).toContain("Fix search\nVerify restart");
  });
});
