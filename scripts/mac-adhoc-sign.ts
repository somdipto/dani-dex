// Ad-hoc signs every Mach-O file in a bundled runtime tree that carries no signature.
//
// The Intel Hermes tree is staged on an arm64 runner from x86_64 wheels, and its interpreter and
// extension modules arrive unsigned (the arm64 ones are signed by the linker). On a Mac, an unsigned
// binary inside an app downloaded from the internet is assessed again at each load instead of from a
// cached code signature, which is part of what made the first start on an Intel MacBook so slow it
// timed out. An ad-hoc signature needs no identity, so the unsigned release can carry it too.

import { execFileSync } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

/** 32- and 64-bit Mach-O in either byte order, and a universal (fat) file. */
const MACH_O_MAGICS = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

/** True for a Mach-O file. A Java class file shares the fat magic, and is told apart by its version. */
export function isMachO(header: Buffer): boolean {
  if (header.length < 8) return false;
  const magic = header.readUInt32BE(0);
  if (!MACH_O_MAGICS.has(magic)) return false;
  if (magic === 0xcafebabe) {
    // A fat header counts its architectures here; a class file stores a version of 45 or more.
    const architectures = header.readUInt32BE(4);
    return architectures > 0 && architectures < 20;
  }
  return true;
}

export async function machOFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const handle = await open(path, "r");
    try {
      const header = Buffer.alloc(8);
      const { bytesRead } = await handle.read(header, 0, 8, 0);
      if (isMachO(header.subarray(0, bytesRead))) found.push(path);
    } finally {
      await handle.close();
    }
  }
  return found.sort();
}

export type Codesign = (args: readonly string[]) => void;

const systemCodesign: Codesign = (args) => {
  execFileSync("/usr/bin/codesign", [...args], { stdio: ["ignore", "ignore", "pipe"] });
};

function isSigned(path: string, codesign: Codesign): boolean {
  try {
    codesign(["--verify", path]);
    return true;
  } catch {
    return false;
  }
}

/** The Mach-O files in `root` whose signature does not verify. */
export async function unsignedMachOFiles(root: string, codesign: Codesign = systemCodesign): Promise<string[]> {
  return (await machOFiles(root)).filter((path) => !isSigned(path, codesign));
}

/** Signs the unsigned ones ad hoc and leaves a valid signature as it is. Returns what it signed. */
export async function adHocSignTree(root: string, codesign: Codesign = systemCodesign): Promise<string[]> {
  const unsigned = await unsignedMachOFiles(root, codesign);
  for (const path of unsigned) codesign(["--force", "--sign", "-", "--timestamp=none", path]);
  const remaining = await unsignedMachOFiles(root, codesign);
  if (remaining.length > 0) throw new Error(`These files did not take an ad-hoc signature:\n${remaining.join("\n")}`);
  return unsigned;
}
