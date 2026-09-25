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
