import type { AgentSummary, ChannelCommand, ChannelDraft } from "@dani-dex/contracts/ipc";
import { GOAL_TEAM_TEMPLATES, type GoalTeamTemplate, goalTeamInstructions } from "./goal-team-templates";

/** Use the native agent/channel APIs; don't manufacture a fake conversation or auto-run a goal. */
export async function installGoalTeam(
  template: GoalTeamTemplate,
  api: {
    createAgent: (input: {
      name: string;
      description: string;
      avatarSeed: string;
      avatarHue: null;
      initialMessage: string;
    }) => Promise<AgentSummary>;
    channelCommand: (command: ChannelCommand) => Promise<unknown>;
  },
  onAgentCreated: (agent: AgentSummary) => void,
): Promise<string> {
  if (!GOAL_TEAM_TEMPLATES.includes(template)) throw new Error("Unknown team template.");
  const ids: string[] = [];
  try {
    for (const role of template.roles) {
      const name = `${template.name}: ${role.name}`.slice(0, 80);
      const description = `${role.responsibility} Coordinate with the other members of the ${template.name} channel. Do not treat your role description as a task request.`;
      const agent = await api.createAgent({
        name,
        description,
        avatarSeed: crypto.randomUUID(),
        avatarHue: null,
        initialMessage: `Your role: ${role.responsibility} There is no specific task yet. Greet briefly; wait for the user's goal in the group channel.`,
      });
      ids.push(agent.id);
      onAgentCreated(agent);
    }
    const channelId = crypto.randomUUID();
    const draft: ChannelDraft = {
      name: template.name,
      title: "One goal, three specialist agents",
      instructions: goalTeamInstructions(template),
      members: ids.map((agentId) => ({ agentId })),
      leadAgentId: ids[0] ?? null,
    };
    await api.channelCommand({ type: "save", operationId: crypto.randomUUID(), channelId, draft });
    return channelId;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Could not finish ${template.name}. ${ids.length} agent(s) were created and kept. ${reason}`);
  }
}
