import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { isBoolean, isDynamicRecord } from "@dani-dex/contracts/runtime-values";

export const DANI_FREE_PREFERENCE_FILE = "dani-free-preference.json";

/**
 * How Dani's models are served. `privateMode` asks the proxy to use only services that do not keep
 * or train on prompts. `freeModelsNoticeAcknowledged` records that the first-launch notice about the
 * free models was shown and dismissed, so it is shown once.
 */
export type DaniFreePreference = {
  readonly privateMode: boolean;
  readonly freeModelsNoticeAcknowledged: boolean;
};

const DEFAULT_PREFERENCE: DaniFreePreference = { privateMode: false, freeModelsNoticeAcknowledged: false };

/** A damaged file falls back to the default, and the notice is shown again rather than skipped. */
export async function readDaniFreePreference(path: string): Promise<DaniFreePreference> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!isDynamicRecord(parsed) || parsed.version !== 1) return { ...DEFAULT_PREFERENCE };
    return {
      privateMode: isBoolean(parsed.privateMode) ? parsed.privateMode : DEFAULT_PREFERENCE.privateMode,
      freeModelsNoticeAcknowledged: parsed.freeModelsNoticeAcknowledged === true,
    };
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return { ...DEFAULT_PREFERENCE };
    throw error;
  }
}

export async function writeDaniFreePreference(
  path: string,
  change: Partial<DaniFreePreference>,
): Promise<DaniFreePreference> {
  const preference = { ...(await readDaniFreePreference(path)), ...change };
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ version: 1, ...preference })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    return preference;
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
