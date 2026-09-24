import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { isDynamicRecord } from "@dani-dex/contracts/runtime-values";
import { createDaniDexLogger, redactText } from "@dani-dex/logging";
import { parse } from "yaml";
import { cliSpawnTarget } from "./cli";

const execFileAsync = promisify(execFile);
const logger = createDaniDexLogger("hermes-repair");

/** One `hermes doctor --fix` run. It takes about two seconds; the budget covers a slow first start. */
export const HERMES_DOCTOR_TIMEOUT_MS = 60_000;
/** Written after a clean repair, so a Hermes version is checked by its own doctor once. */
export const HERMES_DOCTOR_MARKER = ".dani-dex-doctor.json";

export interface HermesRepairInput {
  readonly executable: string;
  readonly version: string;
  /** Dani-Dex's own Hermes state directory. The repair never reaches outside it. */
  readonly hermesHome: string;
  /** Injected by tests; runs `hermes doctor --fix` and returns what it printed. */
  readonly runDoctor?: (executable: string, hermesHome: string) => Promise<string>;
}

export type HermesRepairResult = "healthy" | "repaired" | "failed";

/**
 * Keeps Dani-Dex's Hermes state directory in a shape Hermes can start from, without the user ever
 * seeing it. The directory is Dani-Dex's alone (never `~/.hermes`), so repairing it touches nothing
 * the user set up by hand.
 *
 * Hermes' own `doctor --fix` recreates a missing `.env` and `config.yaml` and migrates the config.
 * It does not repair a `config.yaml` it cannot parse: Hermes then runs on defaults and warns on
 * every start. That file is moved aside first, so the doctor writes a fresh one.
 *
 * Run when the Hermes version changed since the last clean repair, or when the state is visibly
 * broken. Never throws: a failed repair is logged, and the start goes on to report its own error.
 */
export async function repairHermesHome(input: HermesRepairInput): Promise<HermesRepairResult> {
  const broken = await brokenState(input.hermesHome);
  if (!broken && (await markerVersion(input.hermesHome)) === input.version) return "healthy";
  const runDoctor = input.runDoctor ?? runHermesDoctor;
  try {
    await mkdir(input.hermesHome, { recursive: true });
    if (broken === "config-unreadable") {
      const config = join(input.hermesHome, "config.yaml");
      await rename(config, `${config}.dani-dex-reset-${Date.now()}.bak`);
    }
    const output = await runDoctor(input.executable, input.hermesHome);
    const remaining = await brokenState(input.hermesHome);
    if (remaining) {
      logger.warn("Hermes state is still broken after repair.", {
        state: remaining,
        output: redactText(output.slice(-1500)),
      });
      return "failed";
    }
    await writeFile(
      join(input.hermesHome, HERMES_DOCTOR_MARKER),
      `${JSON.stringify({ version: input.version })}\n`,
      "utf8",
    );
    logger.info("Hermes state checked.", { version: input.version, reason: broken ?? "version" });
    return broken ? "repaired" : "healthy";
  } catch (error) {
    logger.warn("Hermes repair did not finish.", {
      error: redactText(error instanceof Error ? error.message : String(error)),
    });
    return "failed";
  }
}

async function brokenState(hermesHome: string): Promise<"missing" | "config-unreadable" | null> {
  try {
    await stat(join(hermesHome, ".env"));
    const config = await readFile(join(hermesHome, "config.yaml"), "utf8");
    return isDynamicRecord(parse(config)) ? null : "config-unreadable";
  } catch (error) {
    return isDynamicRecord(error) && error.code === "ENOENT" ? "missing" : "config-unreadable";
  }
}

async function markerVersion(hermesHome: string): Promise<string | null> {
  try {
    const value = JSON.parse(await readFile(join(hermesHome, HERMES_DOCTOR_MARKER), "utf8"));
    return isDynamicRecord(value) && typeof value.version === "string" ? value.version : null;
  } catch {
    return null;
  }
}

/** `hermes doctor --fix` against Dani-Dex's state directory, with no terminal and no input. */
export async function runHermesDoctor(executable: string, hermesHome: string): Promise<string> {
  const target = cliSpawnTarget(executable, ["doctor", "--fix"]);
  try {
    const { stdout, stderr } = await execFileAsync(target.command, target.args, {
      env: { ...process.env, HERMES_HOME: hermesHome, NO_COLOR: "1" },
      timeout: HERMES_DOCTOR_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      windowsVerbatimArguments: target.windowsVerbatimArguments,
    });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    // The doctor exits non-zero when anything it cannot fix remains (a missing optional key, say).
    // What it did fix is still done, so its output is kept and the state is checked on its own.
    if (isDynamicRecord(error) && typeof error.stdout === "string") {
      return `${error.stdout}\n${typeof error.stderr === "string" ? error.stderr : ""}`;
    }
    throw error;
  }
}
