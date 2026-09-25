import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createDaniDexLogger } from "@dani-dex/logging";

const logger = createDaniDexLogger("install-dani-free");

/** The five executables the Dani-Free build makes, keyed by where the app looks for them. */
export const DANI_FREE_TARGETS = [
  { platform: "darwin", arch: "arm64", artifact: "dani-free-darwin-arm64" },
  { platform: "darwin", arch: "x64", artifact: "dani-free-darwin-x64" },
  { platform: "linux", arch: "x64", artifact: "dani-free-linux-x64" },
  { platform: "linux", arch: "arm64", artifact: "dani-free-linux-arm64" },
  { platform: "win32", arch: "x64", artifact: "dani-free-windows-x64.exe" },
] as const;

export type DaniFreeTarget = (typeof DANI_FREE_TARGETS)[number];

export function daniFreeTarget(platform: string, arch: string): DaniFreeTarget {
  const target = DANI_FREE_TARGETS.find((entry) => entry.platform === platform && entry.arch === arch);
  if (!target) throw new Error(`Dani-Free has no build for ${platform}-${arch}.`);
  return target;
}

/** Where a staged executable goes; `bundledDaniFreeExecutable` reads this layout under resources. */
export function stagedDaniFreePath(root: string, target: DaniFreeTarget): string {
  return join(root, target.platform, target.arch, target.platform === "win32" ? "dani-free.exe" : "dani-free");
}

/** Parses a `sha256sum` listing into artifact name -> hex digest. */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/.exec(line.trim());
    if (match?.[1] && match[2]) sums.set(match[2], match[1]);
  }
  return sums;
}

/**
 * Builds are not reproducible, so a binary is trusted only if it matches the digest pinned in this
 * repo (the SHA256SUMS of the Dani-Free CI run that made it). A missing pin fails the release.
 */
export function verifyDaniFreeBinary(bytes: Buffer, target: DaniFreeTarget, pinned: Map<string, string>): void {
  const expected = pinned.get(target.artifact);
  if (!expected) throw new Error(`No pinned SHA-256 for ${target.artifact}.`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`${target.artifact} does not match its pinned SHA-256 (${actual} != ${expected}).`);
  }
}

export async function installDaniFree(
  binariesDir: string,
  target: DaniFreeTarget,
  pinnedSumsPath = resolve("scripts/dani-free-binaries.sha256"),
  root = resolve("build/dani-free"),
): Promise<string> {
  const pinned = parseSha256Sums(await readFile(pinnedSumsPath, "utf8"));
  const source = join(binariesDir, target.artifact);
  const bytes = await readFile(source);
  verifyDaniFreeBinary(bytes, target, pinned);
  if (target.platform === "darwin") {
    const machine = target.arch === "arm64" ? 0x0100000c : 0x01000007;
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== machine) {
      throw new Error(`Dani Free proxy is not a ${target.arch} Mach-O executable.`);
    }
  } else if (target.platform === "linux") {
    if (
      bytes.toString("binary", 0, 4) !== "\x7fELF" ||
      bytes.readUInt16LE(18) !== (target.arch === "x64" ? 0x3e : 0xb7)
    ) {
      throw new Error(`Dani Free proxy is not a ${target.arch} ELF executable.`);
    }
  } else if (target.platform === "win32") {
    if (bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Dani Free proxy is not a PE executable.");
    const offset = bytes.readUInt32LE(0x3c);
    if (bytes.toString("ascii", offset, offset + 4) !== "PE\0\0" || bytes.readUInt16LE(offset + 4) !== 0x8664) {
      throw new Error("Dani Free proxy is not a Windows x64 executable.");
    }
  }
  const destination = stagedDaniFreePath(root, target);
  await mkdir(join(destination, ".."), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  return destination;
}

if (import.meta.main) {
  const [platform, arch] = process.argv.slice(2);
  const binariesDir = process.env.DANI_FREE_BINARIES_DIR;
  if (!platform || !arch || !binariesDir) {
    throw new Error("Usage: DANI_FREE_BINARIES_DIR=<dir> bun scripts/install-dani-free.ts <platform> <arch>");
  }
  const staged = await installDaniFree(resolve(binariesDir), daniFreeTarget(platform, arch));
  logger.info(`Staged Dani-Free at ${staged}.`);
}
