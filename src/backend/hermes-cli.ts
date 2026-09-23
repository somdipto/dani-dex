import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, resolve, win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface HermesCliInfo {
  executable: string;
  version: string;
  source: "system" | "managed";
}

export async function resolveHermesCli(
  input: { systemCandidates?: string[]; bundledExecutable?: string | null } = {},
): Promise<HermesCliInfo> {
  const override = input.systemCandidates === undefined ? process.env.DANI_DEX_HERMES_PATH?.trim() : undefined;
  const systemPaths = input.systemCandidates ?? (override ? [override] : await discoverHermes());
  const managedPath = input.bundledExecutable === undefined ? bundledHermesExecutable() : input.bundledExecutable;
  const system = systemPaths.map((executable) => ({ executable, source: "system" as const }));
  const managed = managedPath ? [{ executable: managedPath, source: "managed" as const }] : [];
  const candidates = (override ? [...system, ...managed] : [...managed, ...system]).filter(
    (candidate, index, all) => all.findIndex((other) => other.executable === candidate.executable) === index,
  );
  let found = false;
  for (const candidate of candidates) {
    if (!(await executable(candidate.executable))) continue;
    found = true;
    try {
      const { stdout } = await execFileAsync(candidate.executable, ["--version"], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        windowsHide: process.platform === "win32",
      });
      return { ...candidate, version: parseHermesVersion(stdout) };
    } catch {
      // Try the remaining candidate.
    }
  }
  throw new Error(
    found
      ? "Hermes was found but could not start. Run `hermes --version` in a terminal."
      : "Hermes is not installed yet.",
  );
}

export function parseHermesVersion(output: string): string {
  const match = output.trim().match(/(?:hermes(?:-agent)?\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?/iu);
  if (!match) throw new Error("Unable to read the Hermes version.");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function bundledHermesExecutable(
  platform = process.platform,
  architecture = process.arch,
  resourcesPath: string | null | undefined = process.resourcesPath,
): string | null {
  const platformDirectory = platform === "darwin" ? "mac" : platform === "linux" ? "linux" : platform === "win32" ? "win" : null;
  if (!platformDirectory || !["x64", "arm64"].includes(architecture)) return null;
  const name = platform === "win32" ? "hermes.exe" : "hermes";
  if (!resourcesPath) return resolve("build", "hermes", platformDirectory, architecture, "bin", name);
  const paths = platform === "win32" ? win32 : posix;
  return paths.join(resourcesPath, "hermes", platformDirectory, architecture, "bin", name);
}

async function discoverHermes(): Promise<string[]> {
  const command = process.platform === "win32" ? "where.exe" : "/usr/bin/env";
  const args = process.platform === "win32" ? ["hermes"] : ["sh", "-lc", "command -v hermes"];
  const candidates: string[] = [];
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 5_000, maxBuffer: 64 * 1024 });
    candidates.push(...stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean));
  } catch {
    // Known install locations are checked below.
  }
  const home = homedir();
  if (process.platform === "win32") {
    if (process.env.APPDATA) candidates.push(win32.join(process.env.APPDATA, "Python", "Scripts", "hermes.exe"));
    candidates.push(win32.join(home, ".local", "bin", "hermes.exe"));
  } else {
    candidates.push(posix.join(home, ".local", "bin", "hermes"), "/opt/homebrew/bin/hermes", "/usr/local/bin/hermes");
  }
  return [...new Set(candidates)];
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
