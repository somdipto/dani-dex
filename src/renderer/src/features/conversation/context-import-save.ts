import { redactContextText } from "@dani-dex/logging";

const PENDING_KEY = "dani-dex.pending-context-import";
export const IMPORT_TARGET_AGENT_ID = "chief";

/** Saves each text once. Texts the agent already has are counted as saved. Returns the texts that failed. */
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

export function pendingImportTexts(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is string => typeof item === "string").map(redactContextText))]
      : [];
  } catch {
    return [];
  }
}

export function setPendingImportTexts(texts: string[]): void {
  if (texts.length === 0) localStorage.removeItem(PENDING_KEY);
  else localStorage.setItem(PENDING_KEY, JSON.stringify([...new Set(texts.map(redactContextText))]));
}

/**
 * Saves onboarding's staged entries into the chief agent once setup has created it. Whatever could not be
 * saved is kept as pending and offered again when the Memories window opens, so nothing is lost silently.
 */
export async function commitStagedImport(texts: string[]): Promise<string[]> {
  let failed = [...new Set([...pendingImportTexts(), ...texts])];
  if (failed.length === 0) return [];
  setPendingImportTexts(failed);
  try {
    failed = await saveEntriesOnce(
      async () => (await window.danidex.agent.listMemories(IMPORT_TARGET_AGENT_ID)).map((memory) => memory.text),
      async (text) => {
        await window.danidex.agent.createMemory({ agentId: IMPORT_TARGET_AGENT_ID, text });
      },
      failed,
    );
  } catch {
    // Keep the durable copy when the host is unavailable. The Memories panel offers a retry.
  }
  setPendingImportTexts(failed);
  return failed;
}
