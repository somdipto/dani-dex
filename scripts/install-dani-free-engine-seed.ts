import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { daniFreeTarget, parseSha256Sums } from "./install-dani-free";

/** A seed is the extracted executable, never the upstream release archive. */
export async function installDaniFreeEngineSeed(
  source: string,
  platform: string,
  arch: string,
  pinnedSumsPath = resolve("scripts/dani-free-engine-seeds.sha256"),
  root = resolve("build/dani-free-engine"),
): Promise<string> {
  daniFreeTarget(platform, arch);
  const name = `${platform}-${arch}`;
  const expected = parseSha256Sums(await readFile(pinnedSumsPath, "utf8")).get(name);
  if (!expected) throw new Error(`No pinned executable seed SHA-256 for ${name}.`);
  const bytes = await readFile(source);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`Dani Free engine seed executable digest mismatch for ${name}.`);
  if (platform === "darwin") {
    const machine = arch === "arm64" ? 0x0100000c : 0x01000007;
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== machine) {
      throw new Error(`Dani Free engine seed is not a ${arch} Mach-O executable.`);
    }
  } else if (platform === "linux") {
    if (
      bytes.length < 20 ||
      bytes.toString("binary", 0, 4) !== "\x7fELF" ||
      bytes.readUInt16LE(18) !== (arch === "x64" ? 0x3e : 0xb7)
    ) {
      throw new Error(`Dani Free engine seed is not a ${arch} ELF executable.`);
    }
  } else {
    if (bytes.length < 0x40 || bytes.toString("ascii", 0, 2) !== "MZ") {
      throw new Error("Dani Free engine seed is not a Windows PE executable.");
    }
    const offset = bytes.readUInt32LE(0x3c);
    if (
      bytes.length < offset + 6 ||
      bytes.toString("ascii", offset, offset + 4) !== "PE\0\0" ||
      bytes.readUInt16LE(offset + 4) !== 0x8664
    ) {
      throw new Error("Dani Free engine seed is not a Windows x64 executable.");
    }
  }
  const directory = join(root, platform, arch);
  const destination = join(directory, platform === "win32" ? "dani-engine.exe" : "dani-engine");
  await mkdir(directory, { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  const staged = createHash("sha256")
    .update(await readFile(destination))
    .digest("hex");
  if (staged !== expected) throw new Error(`Staged Dani Free engine seed digest mismatch for ${name}.`);
  await writeFile(join(directory, "SHA256.txt"), `${expected}\n`);
  return destination;
}

if (import.meta.main) {
  const [platform, arch, source] = process.argv.slice(2);
  if (!platform || !arch || !source) {
    throw new Error(
      "Usage: bun scripts/install-dani-free-engine-seed.ts <platform> <arch> <extracted-engine-executable>",
    );
  }
  await installDaniFreeEngineSeed(resolve(source), platform, arch);
}
