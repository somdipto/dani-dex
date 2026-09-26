import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDaniDexLogger } from "@dani-dex/logging";
import { bundledDaniFreeExecutable, DaniFreeSupervisor } from "../src/main/dani-free";
import { bundledDaniFreeEngineSeed, verifiedDaniFreeEngineSeed } from "../src/main/dani-free-seed";
import { verifyPackagedDaniFree } from "./verify-packaged-dani-free";

const logger = createDaniDexLogger("smoke-packaged-dani-free");

/** Start the real bundled proxy, wait for its authenticated single-model handshake, and stop it. */
export async function smokePackagedDaniFree(resources: string, platform: NodeJS.Platform, arch: string): Promise<void> {
  if (platform !== process.platform || arch !== process.arch) {
    throw new Error(`Run Dani Free smoke on its native ${platform}-${arch} host.`);
  }
  await verifyPackagedDaniFree(resources, platform, arch);
  const executable = bundledDaniFreeExecutable(resources, platform, arch);
  const seed = bundledDaniFreeEngineSeed(resources, platform, arch);
  if (!executable || !seed) throw new Error("Dani Free packaged proxy or seed is missing.");
  const engineSeed = await verifiedDaniFreeEngineSeed(seed);
  const home = await mkdtemp(join(tmpdir(), "dani-free-package-smoke-"));
  const supervisor = new DaniFreeSupervisor({ executable, home, engineSeed });
  try {
    const source = await supervisor.start();
    if (source?.id !== "dani" || source.models.length !== 1 || source.models[0]?.id !== "dani-free-auto") {
      throw new Error("Packaged Dani Free did not start with its single routing model.");
    }
    logger.info(`Packaged Dani Free ${platform}-${arch} answered its authenticated model handshake.`);
  } finally {
    await supervisor.stop();
    // Windows may still hold a catalog file briefly after the proxy process exits.
    // Teardown cannot turn a successful authenticated smoke into a packaging failure.
    try {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (error) {
      logger.warn("Could not remove the temporary Dani Free smoke profile:", error);
    }
  }
}

if (import.meta.main) {
  const [resources, platform, arch] = process.argv.slice(2);
  if (!resources || !arch || (platform !== "darwin" && platform !== "win32" && platform !== "linux")) {
    throw new Error("Usage: bun scripts/smoke-packaged-dani-free.ts <resources> <darwin|win32|linux> <arch>");
  }
  await smokePackagedDaniFree(resolve(resources), platform, arch);
}
