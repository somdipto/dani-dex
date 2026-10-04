import { expect, it } from "vitest";
import { isAgentModel, isAgentModelOption } from "./ipc-agent-identity";

it.each(["openrouter/~anthropic/claude-sonnet-4", "openrouter/~openai/gpt-5"])(
  "accepts routed alias %s through the whole option guard",
  (id) => {
    expect(isAgentModel(id)).toBe(true);
    expect(
      isAgentModelOption({
        provider: "opencode",
        id,
        name: "CLI alias",
        description: "Discovered alias",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["high"],
      }),
    ).toBe(true);
  },
);
it.each([
  "~openai/gpt-5",
  "opencode/~openai/gpt-5",
  "openrouter/openai/~gpt-5",
  "openrouter/~~openai/gpt-5",
  "openrouter/~openai/",
  "openrouter/~openai/gpt 5",
  "openrouter/~openai/gpt\\5",
  "openrouter/~openai/gpt\n5",
  'openrouter/~openai/gpt"5',
])("still rejects malformed alias %s", (id) => expect(isAgentModel(id)).toBe(false));
it("preserves original ordinary IDs and the length bound", () => {
  expect(isAgentModel("dani/dani-free-auto")).toBe(true);
  expect(isAgentModel("claude-fable-5-1[1m]")).toBe(true);
  expect(isAgentModel(`openrouter/~openai/${"x".repeat(160)}`)).toBe(false);
});
