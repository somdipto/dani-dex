import { CONTEXT_IMPORT_LIMITS } from "@dani-dex/contracts/context-import";
import { redactContextText } from "@dani-dex/logging";

export type ImportProvider = "ChatGPT" | "Claude";
export interface ImportEntry {
  id: number;
  text: string;
  keep: boolean;
  redacted: boolean;
}

export function parseImport(raw: string, provider: ImportProvider): { entries: ImportEntry[]; rejected: string[] } {
  if (raw.length > CONTEXT_IMPORT_LIMITS.pastedText)
    throw new Error("The pasted context is too large. Import a smaller section.");
  const entries: ImportEntry[] = [];
  const rejected: string[] = [];
  for (const line of redactContextText(raw).split(/\r?\n/u)) {
    const body = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim();
    if (body.length < 4 || body.startsWith("```") || /^[A-Za-z ]+:$/u.test(body)) continue;
    if (!/^.+\|\s*Source:\s*[^|\s][^|]*\|\s*Uncertainty:\s*\S.*$/iu.test(body)) {
      rejected.push(body);
      continue;
    }
    const text = `Imported from ${provider} (historical): ${body}`;
    if (entries.some((entry) => entry.text === text)) continue;
    entries.push({ id: entries.length, text, keep: true, redacted: body.includes("[redacted") });
  }
  return { entries, rejected };
}
