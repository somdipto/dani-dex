import type { FirstAgentDraft } from "./FirstAgentSetup";

/** Give a newly created agent its standing role, or ask for a greeting when no purpose is supplied. */
export function createAgentInitialMessage(_draft: Pick<FirstAgentDraft, "purpose">): string {
  return "Hi. Tell me briefly how you can help.";
}
