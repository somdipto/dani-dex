import { INPUT_LIMITS } from "./input-limits";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * How often a bot's operating instructions are rewritten: once every this many of the user's own
 * completed turns with it. Counted from the last rewrite or the user's last edit, whichever is later.
 */
export const OPERATING_INSTRUCTIONS_REFRESH_TURNS = 10;

/** `none` until the first rewrite; `edited` once the user has written in them, until the next rewrite. */
export type OperatingInstructionsSource = "none" | "generated" | "edited";

/**
 * A bot's working method for its remit, distilled from the user's own messages every
 * `OPERATING_INSTRUCTIONS_REFRESH_TURNS` turns and shown to the user, who can rewrite or pause them.
 * They sit under the profile the user wrote, never over it.
 */
export interface AgentOperatingInstructions {
  agentId: string;
  text: string;
  source: OperatingInstructionsSource;
  revision: number;
  autoEvolve: boolean;
  userTurns: number;
  turnsUntilRefresh: number;
  refreshing: boolean;
  updatedAt: string | null;
}

export interface UpdateAgentOperatingInstructionsInput {
  agentId: string;
  /** Empty clears them; the next rewrite starts again from the conversation. */
  text?: string;
  autoEvolve?: boolean;
}

function isCount(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 0;
}

export function isAgentOperatingInstructions(value: unknown): value is AgentOperatingInstructions {
  return (
    isDynamicRecord(value) &&
    isString(value.agentId) &&
    value.agentId.length > 0 &&
    value.agentId.length <= INPUT_LIMITS.identifier &&
    isString(value.text) &&
    value.text.length <= INPUT_LIMITS.agentOperatingInstructions &&
    isOneOf(["none", "generated", "edited"] as const, value.source) &&
    isCount(value.revision) &&
    isBoolean(value.autoEvolve) &&
    isCount(value.userTurns) &&
    isCount(value.turnsUntilRefresh) &&
    isBoolean(value.refreshing) &&
    (value.updatedAt === null || isString(value.updatedAt))
  );
}
