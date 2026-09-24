import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledDaniFreeExecutable } from "../src/main/dani-free";
import {
  DANI_FREE_TARGETS,
  daniFreeTarget,
  installDaniFree,
  parseSha256Sums,
  stagedDaniFreePath,
} from "./install-dani-free";

const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

describe("bundled Dani-Free", () => {
  it("stages each target where the app looks for it at run time", () => {
    for (const target of DANI_FREE_TARGETS) {
      const staged = stagedDaniFreePath("/resources/dani-free", target);
      const expected = join(
        "/resources/dani-free",
        target.platform,
        target.arch,
        target.platform === "win32" ? "dani-free.exe" : "dani-free",
      );
      expect(staged).toBe(expected);
    }
    expect(() => daniFreeTarget("win32", "arm64")).toThrow("no build");
  });

  it("reads sha256sum output, including binary-mode stars", () => {
    const a = sha("a");
    expect(parseSha256Sums(`${a}  dani-free-linux-x64\n${a} *dani-free-windows-x64.exe\n\n`)).toEqual(
      new Map([
        ["dani-free-linux-x64", a],
        ["dani-free-windows-x64.exe", a],
      ]),
    );
  });

  it("stages only a binary that matches its pin, executable, where the app finds it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dani-free-stage-"));
    const target = daniFreeTarget("linux", "x64");
    await writeFile(join(dir, target.artifact), "proxy");
    const pins = join(dir, "pins");
    const root = join(dir, "resources", "dani-free");

    await writeFile(pins, `${sha("other")}  ${target.artifact}\n`);
    await expect(installDaniFree(dir, target, pins, root)).rejects.toThrow("does not match its pinned SHA-256");
    await writeFile(pins, "");
    await expect(installDaniFree(dir, target, pins, root)).rejects.toThrow("No pinned SHA-256");

    await writeFile(pins, `${sha("proxy")}  ${target.artifact}\n`);
    const staged = await installDaniFree(dir, target, pins, root);
    expect(await readFile(staged, "utf8")).toBe("proxy");
    expect((await stat(staged)).mode & 0o111).not.toBe(0);
    expect(bundledDaniFreeExecutable(join(dir, "resources"), "linux", "x64")).toBe(staged);
  });
});
