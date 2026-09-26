import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { isDynamicRecord } from "@dani-dex/contracts/runtime-values";
import { redactText } from "@dani-dex/logging";

/** Private, bounded startup history. Never write the proxy's key, ready line, URLs, or request bodies. */
export type DaniFreeStage = "package" | "seed" | "spawn" | "ready" | "key" | "models" | "connected" | "exit";
export type DaniFreeOutcome = "failed" | "ready" | "exited";
export interface DaniFreeDiagnostic {
  at: string;
  stage: DaniFreeStage;
  outcome: DaniFreeOutcome;
  /** A short local-only error, redacted and never included in a shared diagnostics export. */
  detail?: string;
  code?: number | null;
  signal?: string | null;
}

const MAX_LOG_BYTES = 64 * 1024;
const MAX_DETAIL = 500;
export const DANI_FREE_DIAGNOSTIC_FILE = "startup.log";

export async function appendDaniFreeDiagnostic(home: string, entry: Omit<DaniFreeDiagnostic, "at">): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const path = join(home, DANI_FREE_DIAGNOSTIC_FILE);
  try {
    if ((await stat(path)).size >= MAX_LOG_BYTES) await rename(path, `${path}.1`);
  } catch {
    // No previous log to rotate.
  }
  const line: DaniFreeDiagnostic = {
    at: new Date().toISOString(),
    stage: entry.stage,
    outcome: entry.outcome,
    ...(entry.detail ? { detail: redactText(entry.detail).slice(0, MAX_DETAIL) } : {}),
    ...(entry.code !== undefined ? { code: entry.code } : {}),
    ...(entry.signal !== undefined ? { signal: entry.signal } : {}),
  };
  await appendFile(path, `${JSON.stringify(line)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** Only allowlisted fields leave the local log. Raw stderr and file paths never enter an export. */
export async function readDaniFreeDiagnosticSummary(home: string): Promise<{
  events: Omit<DaniFreeDiagnostic, "detail">[];
}> {
  const path = join(home, DANI_FREE_DIAGNOSTIC_FILE);
  const text = await readFile(path, "utf8").catch(() => "");
  const events: Omit<DaniFreeDiagnostic, "detail">[] = [];
  for (const line of text.slice(-MAX_LOG_BYTES).split("\n").slice(-20)) {
    try {
      const item = JSON.parse(line);
      if (!isDynamicRecord(item)) continue;
      const stage = parseStage(item.stage);
      const outcome = parseOutcome(item.outcome);
      if (typeof item.at !== "string" || !stage || !outcome) continue;
      events.push({
        at: item.at,
        stage,
        outcome,
        ...(typeof item.code === "number" || item.code === null ? { code: item.code } : {}),
        ...(typeof item.signal === "string" || item.signal === null ? { signal: item.signal } : {}),
      });
    } catch {
      // A partially written line is not an event.
    }
  }
  return { events };
}

function parseStage(value: unknown): DaniFreeStage | null {
  switch (value) {
    case "package":
    case "seed":
    case "spawn":
    case "ready":
    case "key":
    case "models":
    case "connected":
    case "exit":
      return value;
    default:
      return null;
  }
}

function parseOutcome(value: unknown): DaniFreeOutcome | null {
  switch (value) {
    case "failed":
    case "ready":
    case "exited":
      return value;
    default:
      return null;
  }
}
