import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The seed is a read-only release resource, not a first-launch download. */
export function bundledDaniFreeEngineSeed(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { executable: string; digestFile: string } | null {
  const root = join(resourcesPath, "dani-free-engine", platform, arch);
  const executable = join(root, platform === "win32" ? "dani-engine.exe" : "dani-engine");
  const digestFile = join(root, "SHA256.txt");
  return existsSync(executable) && existsSync(digestFile) ? { executable, digestFile } : null;
}

/** A digest independently pinned in the release, checked before passing it to the proxy. */
export async function verifiedDaniFreeEngineSeed(seed: {
  executable: string;
  digestFile: string;
}): Promise<{ executable: string; sha256: string }> {
  const sha256 = (await readFile(seed.digestFile, "utf8")).trim();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Dani Free engine seed digest is invalid.");
  const actual = createHash("sha256")
    .update(await readFile(seed.executable))
    .digest("hex");
  if (actual !== sha256) throw new Error("Dani Free engine seed digest does not match.");
  return { executable: seed.executable, sha256 };
}
