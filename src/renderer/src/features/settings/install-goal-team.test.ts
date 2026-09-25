import type { AgentSummary, ChannelCommand } from "@dani-dex/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { GOAL_TEAM_TEMPLATES } from "./goal-team-templates";
import { installGoalTeam } from "./install-goal-team";

const agentFixture: AgentSummary = {
  id: "agent",
  name: "Researcher",
  title: "",
  description: "",
  notifications: true,
  provider: "opencode",
  model: "free",
  reasoningEffort: "low",
  threadId: "",
  workspacePath: "",
  avatarSeed: "researcher",
  avatarHue: null,
  avatarUrl: null,
  updatedAt: "2026-09-26T00:00:00.000Z",
  preview: "",
};

const template = GOAL_TEAM_TEMPLATES.find((entry) => entry.name === "Bug Reproduction");
if (!template) throw new Error("Missing Bug Reproduction template");

describe("goal team templates", () => {
  it("covers all the public use-case categories with three distinct specialist roles", () => {
    expect(GOAL_TEAM_TEMPLATES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(GOAL_TEAM_TEMPLATES.map((entry) => entry.id)).size).toBe(GOAL_TEAM_TEMPLATES.length);
    expect(new Set(GOAL_TEAM_TEMPLATES.map((entry) => entry.category)).size).toBe(9);
    expect(GOAL_TEAM_TEMPLATES.every((entry) => entry.roles.length === 3)).toBe(true);
  });

  it("creates three real agents, then persists the channel with their identities and a shared goal", async () => {
    const events: string[] = [];
    const created: AgentSummary[] = [];
    const createAgent = vi.fn(async (input: { name: string }) => {
      events.push(`agent:${input.name}`);
      return { ...agentFixture, id: `agent-${events.length}`, name: input.name };
    });
    const channelCommand = vi.fn(async (command: ChannelCommand) => {
      events.push(`channel:${command.type}`);
    });
    const id = await installGoalTeam(template, { createAgent, channelCommand }, (agent) => created.push(agent));
    expect(id).toBeTruthy();
    expect(createAgent).toHaveBeenCalledTimes(3);
    expect(created).toHaveLength(3);
    expect(events).toEqual(expect.arrayContaining(["channel:save"]));
    expect(events.at(-1)).toBe("channel:save");
    const saved = channelCommand.mock.calls[0]?.[0];
    if (!saved) throw new Error("Missing channel command");
    expect(saved.type).toBe("save");
    if (saved.type !== "save") throw new Error("Expected a channel save");
    expect(saved.channelId).toBe(id);
    expect(saved.draft.members.map(({ agentId }) => agentId)).toEqual(created.map(({ id }) => id));
    expect(saved.draft.leadAgentId).toBe(created[0]?.id);
    expect(saved.draft.instructions).toContain("Bug Reproduction");
    expect(saved.draft.instructions).toContain("approval");
  });

  it("does not create a false channel after a partial agent failure", async () => {
    let count = 0;
    const channelCommand = vi.fn();
    const created: AgentSummary[] = [];
    await expect(
      installGoalTeam(
        template,
        {
          createAgent: async () => {
            count += 1;
            if (count === 2) throw new Error("Provider offline");
            return { ...agentFixture, id: "first" };
          },
          channelCommand,
        },
        (agent) => created.push(agent),
      ),
    ).rejects.toThrow("1 agent(s) were created and kept. Provider offline");
    expect(created).toHaveLength(1);
    expect(channelCommand).not.toHaveBeenCalled();
  });
});
