/**
 * Fails a release whose installer would ship a broken Computer Use driver.
 *
 * Run on the packaged app, on the operating system it is for:
 *
 *   bun scripts/verify-cua-driver-package.ts dist/mac-universal/Dani-Dex.app/Contents/Resources darwin-arm64
 *   bun scripts/verify-cua-driver-package.ts dist/win-unpacked/resources win32-x64
 *
 * Checks, in order: every pinned file is there, matches its SHA-256 and is runnable; the licence is
 * there; on macOS the binary is universal (Intel Macs run the same file as Apple Silicon) and keeps
 * its vendor signature; `--version` answers with the pinned version from each slice this runner can
 * execute; and `serve` starts the way the app starts it and lists its tools on that address.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDaniDexLogger } from "@dani-dex/logging";
import { CUA_DRIVER_TARGETS, type CuaDriverTarget, cuaDriverTargets, loadCuaDriverLock } from "./cua-driver-lock";
import { verifyCuaDriverTree } from "./install-cua-driver";

const logger = createDaniDexLogger("verify-cua-driver-package");

/** The directory inside `resources` a packaged app carries its driver in, per target. */
export function packagedCuaDriverDirectory(resourcesPath: string, target: CuaDriverTarget): string {
  const { platform, architecture } = CUA_DRIVER_TARGETS[target];
  return join(resourcesPath, "cua-driver", platform, architecture);
}

/** The architectures `lipo -archs` must report for the macOS driver. */
export const MAC_DRIVER_ARCHITECTURES = ["arm64", "x86_64"] as const;

export function missingArchitectures(lipoOutput: string): string[] {
  const present = lipoOutput.trim().split(/\s+/u);
  return MAC_DRIVER_ARCHITECTURES.filter((architecture) => !present.includes(architecture));
}

export function expectVersion(output: string, version: string): void {
  if (!output.includes(`cua-driver ${version}`)) {
    throw new Error(`The packaged cua-driver answered "${output.trim()}", not cua-driver ${version}.`);
  }
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function canRunIntelSlice(): boolean {
  return spawnSync("arch", ["-x86_64", "/usr/bin/true"]).status === 0;
}

/** Starts `serve` the way the app does and requires it to stay up. */
async function smokeServe(executable: string, platform: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "cua-smoke-"));
  const socket = platform === "win32" ? `\\\\.\\pipe\\dani-dex-cua-smoke-${process.pid}` : join(directory, "d.sock");
  const child = spawn(executable, ["serve", "--socket", socket, "--no-overlay"], {
    env: {
      ...process.env,
      CUA_DRIVER_EMBEDDED: "1",
      CUA_DRIVER_RS_TELEMETRY_ENABLED: "0",
      CUA_DRIVER_RS_UPDATE_CHECK: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });
  try {
    const exited = await new Promise<number | null | "running">((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise("running"), 5_000);
      child.once("error", () => {
        clearTimeout(timer);
        resolvePromise(-1);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolvePromise(code);
      });
    });
    if (exited !== "running") {
      throw new Error(`cua-driver serve stopped within 5 seconds (code ${exited}). Output:\n${output}`);
    }
    if (platform !== "win32" && !existsSync(socket)) {
      throw new Error(`cua-driver serve is running but made no socket at ${socket}. Output:\n${output}`);
    }
    // The same address the app hands its agents: the daemon must answer with its tools there.
    const tools = run(executable, ["list-tools", "--socket", socket]);
    const toolCount = tools.split("\n").filter((line) => /^[a-z_]+: /u.test(line)).length;
    if (toolCount < 5) throw new Error(`cua-driver serve answered with ${toolCount} tools:\n${tools}`);
    logger.info(`cua-driver serve answered with ${toolCount} tools.`);
  } finally {
    child.kill();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function verifyPackagedCuaDriver(resourcesPath: string, target: CuaDriverTarget): Promise<void> {
  const lock = await loadCuaDriverLock();
  const descriptor = CUA_DRIVER_TARGETS[target];
  const directory = packagedCuaDriverDirectory(resourcesPath, target);
  const executable = join(directory, descriptor.executable);

  await verifyCuaDriverTree(directory, target, lock);
  logger.info(`${executable} matches the ${lock.version} pin.`);

  if (descriptor.platform === "darwin") {
    const missing = missingArchitectures(run("lipo", ["-archs", executable]));
    if (missing.length > 0) throw new Error(`The macOS cua-driver is missing the ${missing.join(", ")} slice.`);
    run("codesign", ["--verify", "--strict", "--verbose=2", executable]);
    expectVersion(run("arch", ["-arm64", executable, "--version"]), lock.version);
    if (canRunIntelSlice()) {
      expectVersion(run("arch", ["-x86_64", executable, "--version"]), lock.version);
    } else {
      logger.warn("Rosetta is not available on this runner; the x86_64 slice was checked by lipo only.");
    }
  } else {
    expectVersion(run(executable, ["--version"]), lock.version);
  }

  await smokeServe(executable, descriptor.platform);
  logger.info(`The packaged cua-driver for ${target} is present, pinned, runnable and serves.`);
}

if (import.meta.main) {
  const [resourcesArgument, targetArgument] = process.argv.slice(2);
  const target = cuaDriverTargets.find((candidate) => candidate === targetArgument);
  if (!resourcesArgument || !target) {
    throw new Error(`Usage: verify-cua-driver-package.ts <resources path> <${cuaDriverTargets.join("|")}>`);
  }
  await verifyPackagedCuaDriver(resolve(resourcesArgument), target);
}
