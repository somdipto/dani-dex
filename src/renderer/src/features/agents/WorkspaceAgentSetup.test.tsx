import type { AgentModelOption } from "@dani-dex/contracts/ipc";
import { expect, it } from "vitest";
import { daniFreeModelChoices } from "./WorkspaceAgentSetup";

const option = (provider: AgentModelOption["provider"], id: string): AgentModelOption => ({
  provider,
  id,
  name: id,
  description: "",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: ["medium"],
});

it("offers exactly Dani Free Auto for creation even if the backend lists Zen and custom models", () => {
  const dani = option("opencode", "dani/dani-free-auto");
  expect(
    daniFreeModelChoices([
      option("opencode", "opencode/big-pickle"),
      option("opencode", "opencode/muse-free"),
      option("opencode", "custom/local"),
      option("claude", "claude-sonnet"),
      dani,
    ]),
  ).toEqual([dani]);
  expect(daniFreeModelChoices([option("opencode", "opencode/big-pickle")])).toEqual([]);
});
