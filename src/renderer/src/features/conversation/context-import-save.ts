import {
  CONTEXT_IMPORT_LIMITS,
  isLocalContextImportScope,
  type LocalContextImportScope,
} from "@dani-dex/contracts/context-import";
import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import { isDynamicRecord, isString } from "@dani-dex/contracts/runtime-values";
import { redactContextText } from "@dani-dex/logging";

const LEGACY_KEY = "dani-dex.pending-context-import";
export const IMPORT_TARGET_AGENT_ID = "chief";
interface PendingEntry {
  id: string;
  text: string;
}
interface PendingBatch {
  version: 2;
  scope: LocalContextImportScope;
  batchId: string;
  entries: PendingEntry[];
}

function storageKey(scope: LocalContextImportScope): string {
  if (!isLocalContextImportScope(scope)) throw new Error("The import needs a local account and agent destination.");
  return `${LEGACY_KEY}.v2:${encodeURIComponent(JSON.stringify([scope.accountId, scope.serverId, scope.agentId]))}`;
}

function readBatch(scope: LocalContextImportScope): PendingBatch | null {
  const raw = localStorage.getItem(storageKey(scope));
  if (raw === null) return null;
  if (raw.length > CONTEXT_IMPORT_LIMITS.pendingStorage)
    throw new Error("The pending import is too large. It has been kept for recovery.");
  const value = JSON.parse(raw);
  if (
    !isDynamicRecord(value) ||
    value.version !== 2 ||
    !isLocalContextImportScope(value.scope) ||
    storageKey(value.scope) !== storageKey(scope) ||
    !isString(value.batchId) ||
    !Array.isArray(value.entries) ||
    value.entries.length > INPUT_LIMITS.agentMemories
  ) {
    throw new Error("The pending import has no valid destination. It has been kept for recovery.");
  }
  const entries: PendingEntry[] = [];
  for (const entry of value.entries) {
    if (
      !isDynamicRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.text) ||
      entry.text.length > INPUT_LIMITS.agentMemoryText
    ) {
      throw new Error("The pending import is invalid. It has been kept for recovery.");
    }
    entries.push({ id: entry.id, text: redactContextText(entry.text) });
  }
  return { version: 2, scope: { ...scope }, batchId: value.batchId, entries };
}

export function pendingImportTexts(scope: LocalContextImportScope): string[] {
  try {
    return readBatch(scope)?.entries.map((entry) => entry.text) ?? [];
  } catch {
    return [];
  } // A damaged batch is held; writes below refuse to overwrite it.
}

export function legacyPendingImportTexts(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null || raw.length > CONTEXT_IMPORT_LIMITS.pendingStorage) return [];
    const value = JSON.parse(raw);
    return Array.isArray(value) &&
      value.length <= INPUT_LIMITS.agentMemories &&
      value.every((text) => isString(text) && text.length <= INPUT_LIMITS.agentMemoryText)
      ? [...new Set(value.map(redactContextText))]
      : [];
  } catch {
    return [];
  }
}

/** Web Locks serialize every read/modify/write across the app's windows without holding IPC open. */
function withImportLock<Result>(key: string, operation: () => Result | PromiseLike<Result>): Promise<Result> {
  if (!navigator.locks)
    return Promise.reject(new Error("Safe import storage is unavailable. Restart Dani-Dex before importing memories."));
  return navigator.locks.request(key, operation);
}

function writePendingImportTexts(scope: LocalContextImportScope, texts: string[]): void {
  const current = readBatch(scope);
  const unique = [...new Set(texts.map(redactContextText))];
  if (
    unique.length > INPUT_LIMITS.agentMemories ||
    unique.some((text) => !text.trim() || text.length > INPUT_LIMITS.agentMemoryText)
  ) {
    throw new Error("The import exceeds the memory limits. Review and shorten its entries.");
  }
  const batch: PendingBatch = {
    version: 2,
    scope: { ...scope },
    batchId: current?.batchId ?? crypto.randomUUID(),
    entries: unique.map(
      (text) => current?.entries.find((entry) => entry.text === text) ?? { id: crypto.randomUUID(), text },
    ),
  };
  if (batch.entries.length === 0) localStorage.removeItem(storageKey(scope));
  else localStorage.setItem(storageKey(scope), JSON.stringify(batch));
}

/** Staging is additive, including when a window's displayed list is older than another window's. */
export function setPendingImportTexts(scope: LocalContextImportScope, texts: string[]): Promise<void> {
  return withImportLock(storageKey(scope), () =>
    writePendingImportTexts(scope, [...pendingImportTexts(scope), ...texts]),
  );
}

/** Rebinding requires a separate explicit review. An unscoped older batch is never sent or deleted on startup. */
export function adoptLegacyImport(scope: LocalContextImportScope, reviewedTexts: string[]): Promise<void> {
  return withImportLock(LEGACY_KEY, async () => {
    const legacy = legacyPendingImportTexts();
    if (legacy.length === 0 || JSON.stringify(legacy) !== JSON.stringify(reviewedTexts)) {
      throw new Error("The older import changed. Review it again before choosing its destination.");
    }
    await setPendingImportTexts(scope, legacy);
    localStorage.removeItem(LEGACY_KEY);
  });
}

/** Each create reaches the owning database's duplicate check; a lost response remains safe to retry. */
export async function saveEntriesOnce(
  existing: () => Promise<string[]>,
  create: (text: string) => Promise<void>,
  texts: string[],
): Promise<string[]> {
  const have = new Set(await existing());
  const failed: string[] = [];
  for (const text of new Set(texts.map(redactContextText))) {
    if (have.has(text)) continue;
    try {
      await create(text);
      have.add(text);
    } catch {
      failed.push(text);
    }
  }
  return failed;
}

export async function commitStagedImport(scope: LocalContextImportScope, texts: string[]): Promise<string[]> {
  if (texts.length === 0 && pendingImportTexts(scope).length === 0) return [];
  const snapshot = await withImportLock(storageKey(scope), () => {
    writePendingImportTexts(scope, [...pendingImportTexts(scope), ...texts]);
    return readBatch(scope);
  });
  if (!snapshot || snapshot.entries.length === 0) return [];
  const requested = snapshot.entries.map((entry) => entry.text);
  try {
    const result = await window.danidex.agent.importLocalContext({ ...scope, texts: requested });
    const savedIds = new Set(
      snapshot.entries.filter((entry) => !result.failedTexts.includes(entry.text)).map((entry) => entry.id),
    );
    // A newly staged entry from another window must survive this request's completion.
    await withImportLock(storageKey(scope), () => {
      const remaining = readBatch(scope)?.entries.filter((entry) => !savedIds.has(entry.id)) ?? [];
      writePendingImportTexts(
        scope,
        remaining.map((entry) => entry.text),
      );
    });
  } catch {
    // Keep the exact account/agent batch after failed or ambiguous delivery. No reroute or automatic retry.
  }
  return pendingImportTexts(scope);
}
