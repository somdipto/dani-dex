import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { bundledDaniFreeExecutable } from "../src/main/dani-free";
import { bundledDaniFreeEngineSeed, verifiedDaniFreeEngineSeed } from "../src/main/dani-free-seed";
import { daniFreeTarget, parseSha256Sums } from "./install-dani-free";

/** Verify exact release bytes inside the unpacked application, before publishing its installer. */
export async function verifyPackagedDaniFree(
  resourcesPath: string,
  platform: NodeJS.Platform,
  arch: string,
  proxyPinsPath = resolve("scripts/dani-free-binaries.sha256"),
  enginePinsPath = resolve("scripts/dani-free-engine-seeds.sha256"),
): Promise<void> {
  const target = daniFreeTarget(platform, arch);
  const proxy = bundledDaniFreeExecutable(resourcesPath, platform, arch);
  const engine = bundledDaniFreeEngineSeed(resourcesPath, platform, arch);
  if (!proxy || !engine) throw new Error(`Dani Free proxy or engine seed missing for ${platform}-${arch}.`);
  const proxyPins = parseSha256Sums(await readFile(proxyPinsPath, "utf8"));
  const enginePins = parseSha256Sums(await readFile(enginePinsPath, "utf8"));
  const expectedProxy = proxyPins.get(target.artifact);
  const expectedEngine = enginePins.get(`${platform}-${arch}`);
  if (!expectedProxy || !expectedEngine) throw new Error(`Dani Free release digest missing for ${platform}-${arch}.`);
  await access(proxy);
  const actualProxy = createHash("sha256")
    .update(await readFile(proxy))
    .digest("hex");
  const actualEngine = (await verifiedDaniFreeEngineSeed(engine)).sha256;
  if (actualProxy !== expectedProxy || actualEngine !== expectedEngine) {
    throw new Error(`Packaged Dani Free release digest mismatch for ${platform}-${arch}.`);
  }
  if (platform !== "win32") {
    for (const executable of [proxy, engine.executable]) {
      if (!((await stat(executable)).mode & 0o111)) throw new Error(`Packaged Dani Free executable lacks execute bit.`);
    }
  } else {
    for (const executable of [proxy, engine.executable]) {
      const bytes = await readFile(executable);
      if (bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Packaged Dani Free Windows executable is not PE.");
      const offset = bytes.readUInt32LE(0x3c);
      if (bytes.toString("ascii", offset, offset + 4) !== "PE\0\0" || bytes.readUInt16LE(offset + 4) !== 0x8664) {
        throw new Error("Packaged Dani Free Windows executable is not x64 PE.");
      }
    }
  }
  if (platform === "linux") {
    for (const executable of [proxy, engine.executable]) {
      const bytes = await readFile(executable);
      if (bytes.toString("binary", 0, 4) !== "\x7fELF" || bytes.readUInt16LE(18) !== (arch === "x64" ? 0x3e : 0xb7)) {
        throw new Error(`Packaged Dani Free Linux executable is not ${arch} ELF.`);
      }
    }
  }
}

if (import.meta.main) {
  const [resources, platform, arch] = process.argv.slice(2);
  if (!resources || !platform || !arch) {
    throw new Error("Usage: bun scripts/verify-packaged-dani-free.ts <resources> <platform> <arch>");
  }
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
    throw new Error(`Unsupported Dani Free platform: ${platform}.`);
  }
  await verifyPackagedDaniFree(resolve(resources), platform, arch);
}
