// Starts the Hermes a packaged Dani-Dex carries, the way the app starts it, and fails the release if
// it does not answer in time.
//
// The Intel Mac tree used to be checked with `test -x` alone, because the arm64 runner that stages it
// cannot run it natively. It shipped without bytecode and did not start on an Intel MacBook
// ("Hermes was found but could not start"). Rosetta runs it here, so every shipped tree is started.

import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDaniDexLogger } from "@dani-dex/logging";
import { cliSpawnTarget } from "../src/backend/cli";
import { MINIMUM_COMPILED_MODULES } from "./install-hermes-runtime";
import { unsignedMachOFiles } from "./mac-adhoc-sign";

const logger = createDaniDexLogger("verify-packaged-hermes");

/** Well inside the app's own first-start budget, so a CI pass means a real start fits too. */
export const VERSION_BUDGET_MS = 20_000;
export const ACP_BUDGET_MS = 30_000;

interface Launch {
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

/** How the app launches this tree (`cliSpawnTarget`), plus `arch` to pick another Mac slice. */
export function hermesLaunch(
  root: string,
  platform: NodeJS.Platform,
  macArchitecture: string | null,
  args: string[],
): Launch {
  const launcher = join(root, "bin", platform === "win32" ? "hermes.cmd" : "hermes");
  if (platform === "darwin" && macArchitecture) {
    return { command: "arch", args: [`-${macArchitecture}`, launcher, ...args], windowsVerbatimArguments: false };
  }
  return cliSpawnTarget(launcher, args, platform);
}

function run(
  launch: Launch,
  input: string | null,
  budgetMs: number,
  until: (stdout: string) => boolean,
): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const started = Date.now();
    const child = spawn(launch.command, launch.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error);
      else {
        logger.info(`${launch.args.join(" ")} answered in ${Date.now() - started} ms.`);
        resolveRun(stdout);
      }
    };
    const timer = setTimeout(
      () => finish(new Error(`Hermes did not answer within ${budgetMs} ms.\nstdout: ${stdout}\nstderr: ${stderr}`)),
      budgetMs,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (until(stdout)) finish(null);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (until(stdout)) finish(null);
      else finish(new Error(`Hermes exited with code ${String(code)}.\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
    if (input !== null) child.stdin.write(input);
  });
}

export async function verifyPackagedHermes(
  root: string,
  version: string,
  platform: NodeJS.Platform,
  macArchitecture: string | null,
): Promise<void> {
  const compiled = (await readdir(join(root, "python"), { recursive: true })).filter((path) => path.endsWith(".pyc"));
  if (compiled.length < MINIMUM_COMPILED_MODULES) {
    throw new Error(`${root} carries ${compiled.length} compiled modules; the packaged tree must be precompiled.`);
  }
  // Every shipped binary carries at least an ad-hoc signature; see `mac-adhoc-sign.ts`.
  if (platform === "darwin") {
    const unsigned = await unsignedMachOFiles(root);
    if (unsigned.length > 0) {
      throw new Error(`${root} ships ${unsigned.length} unsigned binaries, first ${unsigned.slice(0, 5).join(", ")}.`);
    }
  }
  const output = await run(
    hermesLaunch(root, platform, macArchitecture, ["--version"]),
    null,
    VERSION_BUDGET_MS,
    (stdout) => stdout.includes(`v${version}`),
  );
  if (!output.includes(`v${version}`)) throw new Error(`Unexpected packaged Hermes version: ${output}`);

  // The app talks ACP to `hermes acp`; a server that answers `initialize` is one the app can use.
  const initialize = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "danidex", version: "0.0.0" } },
  })}\n`;
  const answer = await run(
    hermesLaunch(root, platform, macArchitecture, ["acp"]),
    initialize,
    ACP_BUDGET_MS,
    (stdout) => stdout.split("\n").some((line) => line.includes('"id":0') && line.includes('"result"')),
  );
  if (!answer.includes("protocolVersion")) throw new Error(`Hermes ACP answered without a protocol version: ${answer}`);
  logger.info(`Packaged Hermes ${version} at ${root} starts and answers ACP.`);
}

if (import.meta.main) {
  const [rootArgument, macArchitecture] = process.argv.slice(2);
  if (!rootArgument) throw new Error("Usage: verify-packaged-hermes.ts <hermes/<platform>/<arch> root> [x86_64|arm64]");
  const lock = JSON.parse(await readFile(resolve("native-runtime.lock.json"), "utf8"));
  await verifyPackagedHermes(resolve(rootArgument), lock.hermes.version, process.platform, macArchitecture ?? null);
}
