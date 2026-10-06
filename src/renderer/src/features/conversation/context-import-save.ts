const PENDING_KEY = "dani-dex.pending-context-import";
/** The chief of staff is created for every profile and is the agent onboarding speaks about. */
export const IMPORT_TARGET_AGENT_ID = "chief";

/** Saves each text once. Texts the agent already has are counted as saved. Returns the texts that failed. */
export async function saveEntriesOnce(
  existing: () => Promise<string[]>,
  create: (text: string) => Promise<void>,
  texts: string[],
): Promise<string[]> {
  const have = new Set(await existing());
  const failed: string[] = [];
  for (const text of texts) {
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
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function setPendingImportTexts(texts: string[]): void {
  if (texts.length === 0) localStorage.removeItem(PENDING_KEY);
  else localStorage.setItem(PENDING_KEY, JSON.stringify(texts));
}

/**
 * Saves onboarding's staged entries into the chief agent once setup has created it. Whatever could not be
 * saved is kept as pending and offered again when the Memories window opens, so nothing is lost silently.
 */
export async function commitStagedImport(texts: string[]): Promise<void> {
  if (texts.length === 0) return;
  setPendingImportTexts(texts);
  let failed = texts;
  for (let attempt = 0; attempt < 30 && failed.length > 0; attempt += 1) {
    try {
      const agents = await window.danidex.agent.listAgents();
      if (agents.some((agent) => agent.id === IMPORT_TARGET_AGENT_ID)) {
        failed = await saveEntriesOnce(
          async () => (await window.danidex.agent.listMemories(IMPORT_TARGET_AGENT_ID)).map((memory) => memory.text),
          async (text) => {
            await window.danidex.agent.createMemory({ agentId: IMPORT_TARGET_AGENT_ID, text });
          },
          failed,
        );
        if (failed.length === 0) break;
      }
    } catch {
      // The agent service may still be starting. The loop retries; the pending copy covers a final failure.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  setPendingImportTexts(failed);
}
