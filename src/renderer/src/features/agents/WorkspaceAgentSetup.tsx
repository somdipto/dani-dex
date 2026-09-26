import { isFreeOpencodeModel } from "@dani-dex/contracts/ipc";
import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@dani-dex/contracts/team-protocol/current";
import { createEffect, createMemo } from "solid-js";
import { useServers } from "../servers/servers-context";
import { useAgentActions } from "./agent-actions";
import { useAgents } from "./agents-context";
import { FIRST_AGENT_SUGGESTIONS, FirstAgentSetup } from "./FirstAgentSetup";

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
  // The home creation flow uses a listed free model: the local proxy when ready, or a
  // keyless OpenCode model if the proxy failed. Never choose an unknown-price model.
  const daniModel = createMemo(() => {
    if (activeServer()?.kind === "remote" && !activeServerSupportsCapability(TEAM_AGENT_CREATE_MODEL_CAPABILITY)) {
      return undefined;
    }
    return (
      modelOptions().find((option) => option.provider === "opencode" && option.id === "dani/dani-free-auto") ??
      modelOptions().find((option) => option.provider === "opencode" && isFreeOpencodeModel(option.id, option.name))
    );
  });
  createEffect(
    () => daniModel(),
    (model) => {
      if (!model) return;
      const draft = agentSetupDraft();
      if (draft.provider !== "opencode" || draft.model !== model.id) {
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
      onChange={setAgentSetupDraft}
      onSubmit={(draft) => {
        const model = daniModel();
        if (!model) return;
        void createAgent({ ...draft, provider: "opencode", model: model.id });
      }}
      onCancel={agentList().length > 0 ? cancelAgentSetup : undefined}
    />
  );
}
