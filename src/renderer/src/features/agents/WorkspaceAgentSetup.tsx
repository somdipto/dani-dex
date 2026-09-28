import type { AgentModelOption } from "@dani-dex/contracts/ipc";
import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@dani-dex/contracts/team-protocol/current";
import { createEffect, createMemo } from "solid-js";
import { useServers } from "../servers/servers-context";
import { useAgentActions } from "./agent-actions";
import { useAgents } from "./agents-context";
import { FIRST_AGENT_SUGGESTIONS, FirstAgentSetup } from "./FirstAgentSetup";

/** The creation flow never falls back to an upstream or paid model. */
export function daniFreeModelChoices(options: readonly AgentModelOption[]): AgentModelOption[] {
  return options.filter((option) => option.provider === "opencode" && option.id === "dani/dani-free-auto");
}

/**
 * The create-an-agent form, which takes over the conversation pane instead of
 * opening over it. `mode` is derived from the agent list rather than passed in
 * because the first agent and the fifth are the same command with different copy.
 */
export function WorkspaceAgentSetup() {
  const {
    agentList,
    agentSetupDraft,
    setAgentSetupDraft,
    agentSetupError,
    creatingAgent,
    cancelAgentSetup,
    modelOptions,
  } = useAgents();
  const { createAgent } = useAgentActions();
  const { activeServer, activeServerSupportsCapability } = useServers();
  // Only the live Dani Free Auto route can enable agent creation.
  const daniModel = createMemo(() => {
    if (activeServer()?.kind === "remote" && !activeServerSupportsCapability(TEAM_AGENT_CREATE_MODEL_CAPABILITY)) {
      return undefined;
    }
    return daniFreeModelChoices(modelOptions())[0];
  });
  const modelChoices = createMemo(() => daniFreeModelChoices(modelOptions()));
  createEffect(
    () => daniModel(),
    (model) => {
      if (!model) return;
      const draft = agentSetupDraft();
      if (!modelChoices().some((option) => option.id === draft.model && option.provider === draft.provider)) {
        setAgentSetupDraft({ ...draft, provider: "opencode", model: model.id });
      }
    },
  );

  return (
    <FirstAgentSetup
      value={agentSetupDraft()}
      suggestions={FIRST_AGENT_SUGGESTIONS}
      mode={agentList().length === 0 ? "first" : "additional"}
      submitting={creatingAgent()}
      error={agentSetupError()}
      modelReady={Boolean(daniModel())}
      modelChoices={modelChoices()}
      onChange={setAgentSetupDraft}
      onSubmit={(draft) => {
        const available = modelChoices().find(
          (option) => option.id === draft.model && option.provider === draft.provider,
        );
        if (!available) return;
        void createAgent(draft);
      }}
      onCancel={agentList().length > 0 ? cancelAgentSetup : undefined}
    />
  );
}
