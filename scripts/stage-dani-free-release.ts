import { join, resolve } from "node:path";
import { createDaniDexLogger } from "@dani-dex/logging";
import { daniFreeTarget, installDaniFree } from "./install-dani-free";
import { installDaniFreeEngineSeed } from "./install-dani-free-engine-seed";
import { verifyPackagedDaniFree } from "./verify-packaged-dani-free";

const logger = createDaniDexLogger("stage-dani-free-release");

/** Stage only immutable, separately SHA-pinned executable bytes; never download a floating latest. */
export async function stageDaniFreeRelease(
  platform: string,
  arch: string,
  proxyDirectory: string,
  engineDirectory: string,
): Promise<void> {
  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    throw new Error(`Unsupported Dani Free platform: ${platform}.`);
  }
  const target = daniFreeTarget(platform, arch);
  if (!proxyDirectory || !engineDirectory) throw new Error("Dani Free release directories are required.");
  await installDaniFree(proxyDirectory, target);
  await installDaniFreeEngineSeed(
    join(engineDirectory, `${platform}-${arch}`, platform === "win32" ? "dani-engine.exe" : "dani-engine"),
    platform,
    arch,
  );
  // The packager copies these trees under resources; the packaged copy is verified again in CI.
  // This check catches a mismatched stage before any installer is built.
  await verifyPackagedDaniFree(resolve("build"), platform, arch);
  logger.info(`Verified Dani Free release resources for ${platform}-${arch}.`);
}

if (import.meta.main) {
  const [platform, arch] = process.argv.slice(2);
  const proxyDirectory = process.env.DANI_FREE_BINARIES_DIR;
  const engineDirectory = process.env.DANI_FREE_ENGINE_SEEDS_DIR;
  if (!platform || !arch || !proxyDirectory || !engineDirectory) {
    throw new Error(
      "Usage: DANI_FREE_BINARIES_DIR=<dir> DANI_FREE_ENGINE_SEEDS_DIR=<dir> bun scripts/stage-dani-free-release.ts <platform> <arch>",
    );
  }
  await stageDaniFreeRelease(platform, arch, resolve(proxyDirectory), resolve(engineDirectory));
}
