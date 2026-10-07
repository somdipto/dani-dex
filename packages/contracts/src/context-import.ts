import { INPUT_LIMITS } from "./input-limits";
import { isDynamicRecord, isString } from "./runtime-values";

/** An onboarding import belongs to one account on this computer, never the selected remote host. */
export interface LocalContextImportScope {
  accountId: string | null;
  serverId: "local";
  agentId: string;
}

export interface ImportLocalContextInput extends LocalContextImportScope {
  texts: string[];
}

export interface ImportLocalContextResult {
  saved: number;
  failedTexts: string[];
}

export const CONTEXT_IMPORT_LIMITS = { pastedText: 128_000, pendingStorage: 64_000 } as const;

export function isLocalContextImportScope(value: unknown): value is LocalContextImportScope {
  return (
    isDynamicRecord(value) &&
    value.serverId === "local" &&
    (value.accountId === null ||
      (isString(value.accountId) && value.accountId.length > 0 && value.accountId.length <= INPUT_LIMITS.identifier)) &&
    isString(value.agentId) &&
    value.agentId.length > 0 &&
    value.agentId.length <= INPUT_LIMITS.identifier
  );
}

export function parseImportLocalContext(value: unknown): ImportLocalContextInput {
  if (
    !isDynamicRecord(value) ||
    !isLocalContextImportScope(value) ||
    !Array.isArray(value.texts) ||
    value.texts.length > INPUT_LIMITS.agentMemories ||
    !value.texts.every(
      (text) => isString(text) && text.trim().length > 0 && text.length <= INPUT_LIMITS.agentMemoryText,
    )
  )
    throw new Error("Invalid local context import.");
  return { accountId: value.accountId, serverId: "local", agentId: value.agentId, texts: [...value.texts] };
}

export function isImportLocalContextResult(value: unknown): value is ImportLocalContextResult {
  return (
    isDynamicRecord(value) &&
    Number.isInteger(value.saved) &&
    typeof value.saved === "number" &&
    value.saved >= 0 &&
    value.saved <= INPUT_LIMITS.agentMemories &&
    Array.isArray(value.failedTexts) &&
    value.failedTexts.length <= INPUT_LIMITS.agentMemories &&
    value.failedTexts.every((text) => isString(text) && text.length > 0 && text.length <= INPUT_LIMITS.agentMemoryText)
  );
}
