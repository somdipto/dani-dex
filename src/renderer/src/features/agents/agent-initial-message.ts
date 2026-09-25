import type { FirstAgentDraft } from "./FirstAgentSetup";

/** Give a newly created agent its standing role, or ask for a greeting when no purpose is supplied. */
export function createAgentInitialMessage(draft: Pick<FirstAgentDraft, "purpose">): string {
  const purpose = draft.purpose.trim().replace(/[.\s]+$/, "");
  // Small models answer "Your ongoing role is..." with "Which task should I complete?": the role
  // reads as a task to start. Saying plainly that there is nothing to do yet gets the greeting.
  return purpose
    ? `Your ongoing role is: ${purpose}. There is no task yet - just greet me briefly and confirm what you will help with.`
    : "Greet me briefly.";
}
