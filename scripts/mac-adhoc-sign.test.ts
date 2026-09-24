import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adHocSignTree, isMachO, machOFiles } from "./mac-adhoc-sign";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function header(...words: number[]): Buffer {
  const buffer = Buffer.alloc(words.length * 4);
  for (const [index, word] of words.entries()) buffer.writeUInt32BE(word, index * 4);
  return buffer;
}

describe("ad-hoc signing a runtime tree", () => {
  it("recognizes Mach-O files and nothing else", () => {
    expect(isMachO(header(0xcffaedfe, 7))).toBe(true); // x86_64, little-endian
    expect(isMachO(header(0xcafebabe, 2))).toBe(true); // universal, two slices
    expect(isMachO(header(0xcafebabe, 52))).toBe(false); // a Java class file
    expect(isMachO(Buffer.from("#!/bin/sh\n"))).toBe(false);
    expect(isMachO(Buffer.alloc(3))).toBe(false);
  });

  it("signs only the unsigned binaries, at any depth, and fails when one will not take it", async () => {
    const root = await mkdtemp(join(tmpdir(), "adhoc-"));
    directories.push(root);
    await mkdir(join(root, "python", "lib", "site-packages", "PIL", ".dylibs"), { recursive: true });
    await mkdir(join(root, "bin"), { recursive: true });
    const python = join(root, "python", "bin-python3");
    const dylib = join(root, "python", "lib", "site-packages", "PIL", ".dylibs", "libXau.6.dylib");
    const signedAlready = join(root, "python", "lib", "signed.so");
    await writeFile(python, header(0xcffaedfe, 7, 3));
    await writeFile(dylib, header(0xcffaedfe, 7, 3));
    await writeFile(signedAlready, header(0xcffaedfe, 7, 3));
    await writeFile(join(root, "bin", "hermes"), "#!/bin/sh\nexec python3\n");
    await writeFile(join(root, "python", "module.pyc"), Buffer.from([0xa7, 0x0d, 0x0d, 0x0a, 0, 0, 0, 0]));

    expect(await machOFiles(root)).toEqual([signedAlready, python, dylib].sort());

    const signed = new Set([signedAlready]);
    const calls: string[][] = [];
    const codesign = (args: readonly string[]) => {
      calls.push([...args]);
      const path = args.at(-1) ?? "";
      if (args[0] === "--verify") {
        if (!signed.has(path)) throw new Error("code object is not signed at all");
        return;
      }
      signed.add(path);
    };
    expect((await adHocSignTree(root, codesign)).sort()).toEqual([python, dylib].sort());
    expect(calls.filter((args) => args[0] === "--force")).toEqual(
      [python, dylib].sort().map((path) => ["--force", "--sign", "-", "--timestamp=none", path]),
    );

    const stubborn = (args: readonly string[]) => {
      if (args[0] === "--verify" && args.at(-1) === dylib) throw new Error("still unsigned");
    };
    await expect(adHocSignTree(root, stubborn)).rejects.toThrow("libXau.6.dylib");
  });
});
