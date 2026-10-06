import { spawnSync } from "node:child_process";
import fs, { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { README_INSTALL_ASSETS } from "./verify-readme-install-links";

const cli = resolve(import.meta.dirname, "..", "onboard", "bin", "dani-dex-onboard.js");
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "onboard", "package.json"), "utf8"));

const onboardModule = createRequire(import.meta.url)(cli);
if (typeof onboardModule?.pickChecksumTarget !== "function") throw new Error("Onboard checksum parser is missing");
function pickChecksumTarget(sumsText: string, platform: string): { name: string; expected: string } | null {
  const target = onboardModule.pickChecksumTarget(sumsText, platform);
  if (target === null) return null;
  if (typeof target?.name !== "string" || typeof target?.expected !== "string")
    throw new Error("Invalid checksum target");
  return { name: target.name, expected: target.expected };
}

// The real v0.17.8 release checksum files: GNU sha256sum format, versioned file
// names, CRLF on the Windows file, and a macOS file that also lists the .zip.
const REAL_LINUX_SUMS =
  "dd75bc7bd2e5e70b6b64946a27353e072118e48ca61f3f1211c9c5f630ed211d  Dani-Dex-0.17.8-x86_64.AppImage\n";
const REAL_MAC_SUMS =
  "a8b42b661c6f22d4d68f16feb3b68acbb262c592c5d6fc9f2d9b77f0d882f7a3  Dani-Dex-0.17.8-universal.dmg\n" +
  "3c040d713a9844b151d18329d831977614032b33ff23a324e4cf98d99ce0c644  Dani-Dex-0.17.8-universal.zip\n";
const REAL_WINDOWS_SUMS =
  "a5c8363b57b4835dceaa747700918b6972e5750beb80362736fc8b3b69aac449  Dani-Dex-0.17.8-x64.exe\r\n";

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: readonly string[]): RunResult {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: process.env });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("dani-dex-onboard package", () => {
  it("is a zero-dependency CLI whose bin name matches the npx command", () => {
    expect(pkg.name).toBe("dani-dex-onboard");
    expect(pkg.bin).toEqual({ "dani-dex-onboard": "bin/dani-dex-onboard.js" });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.files).toEqual(["bin"]);
  });

  it("--help prints the single command and every public flag", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("npx dani-dex-onboard");
    for (const flag of ["--no-launch", "--install-dir", "--dry-run"]) {
      expect(result.stdout).toContain(flag);
    }
  });

  it.each([
    ["darwin", "arm64", "macos", "Dani-Dex-mac-universal.dmg"],
    ["darwin", "x64", "macos", "Dani-Dex-mac-universal.dmg"],
    ["linux", "x64", "linux", "Dani-Dex-linux-x86_64.AppImage"],
    ["linux", "amd64", "linux", "Dani-Dex-linux-x86_64.AppImage"],
    ["win32", "x64", "windows", "Dani-Dex-windows-x64.exe"],
    ["windows", "x64", "windows", "Dani-Dex-windows-x64.exe"],
  ])("resolves %s/%s to %s", (platformArg, archArg, expectedPlatform, expectedAsset) => {
    const result = run(["--resolve", platformArg, archArg]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`platform=${expectedPlatform}`);
    expect(result.stdout).toContain(`asset=${expectedAsset}`);
    expect(result.stdout).toContain(
      `url=https://github.com/somdipto/dani-dex/releases/latest/download/${expectedAsset}`,
    );
  });

  it.each([
    ["linux", "arm64"],
    ["win32", "arm64"],
    ["freebsd", "x64"],
    ["darwin", "ia32"],
  ])("rejects unsupported %s/%s with a pointer to the releases page", (platformArg, archArg) => {
    const result = run(["--resolve", platformArg, archArg]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("releases/latest");
  });

  it("only ever resolves assets that the README installer buttons also ship", () => {
    for (const [platformArg, archArg] of [
      ["darwin", "arm64"],
      ["linux", "x64"],
      ["win32", "x64"],
    ] as const) {
      const result = run(["--resolve", platformArg, archArg]);
      const asset = result.stdout.match(/^asset=(.+)$/m)?.[1];
      expect(asset).toBeDefined();
      expect(README_INSTALL_ASSETS).toContain(asset);
    }
  });

  it("--dry-run prints the plan and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "dani-dex-onboard-cli-test-"));
    try {
      const result = run(["--dry-run", "--install-dir", dir, "--no-launch"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Plan (dry run");
      expect(result.stdout).toContain("releases/latest/download/");
      expect(result.stdout).toContain(dir);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown options", () => {
    const result = run(["--frobnicate"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown option");
  });

  it("does not treat the next option as an installation path", () => {
    const result = run(["--install-dir", "--no-launch", "--dry-run"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--install-dir needs a path");
  });
});

describe("pickChecksumTarget", () => {
  it("parses the real published checksum files, including versioned names", () => {
    expect(pickChecksumTarget(REAL_LINUX_SUMS, "linux")).toEqual({
      name: "Dani-Dex-0.17.8-x86_64.AppImage",
      expected: "dd75bc7bd2e5e70b6b64946a27353e072118e48ca61f3f1211c9c5f630ed211d",
    });
    expect(pickChecksumTarget(REAL_WINDOWS_SUMS, "windows")).toEqual({
      name: "Dani-Dex-0.17.8-x64.exe",
      expected: "a5c8363b57b4835dceaa747700918b6972e5750beb80362736fc8b3b69aac449",
    });
  });

  it("picks the .dmg over the .zip on macOS", () => {
    expect(pickChecksumTarget(REAL_MAC_SUMS, "macos")).toEqual({
      name: "Dani-Dex-0.17.8-universal.dmg",
      expected: "a8b42b661c6f22d4d68f16feb3b68acbb262c592c5d6fc9f2d9b77f0d882f7a3",
    });
  });

  it("returns null when the file has no entry for the platform, so the CLI fails closed", () => {
    expect(pickChecksumTarget(REAL_WINDOWS_SUMS, "linux")).toBeNull();
    expect(pickChecksumTarget("", "linux")).toBeNull();
  });

  it.each([
    "not-a-hash  Dani-Dex-0.17.8-x86_64.AppImage",
    `${"a".repeat(64)}  ../Dani-Dex-0.17.8-x86_64.AppImage`,
    `${"a".repeat(64)}  /Dani-Dex-0.17.8-x86_64.AppImage`,
    `${"a".repeat(64)}  Dani-Dex-0.17.8-arm64.AppImage`,
    `${REAL_LINUX_SUMS}${REAL_LINUX_SUMS}`,
  ])("rejects an invalid or ambiguous manifest: %s", (sums) => {
    expect(pickChecksumTarget(sums, "linux")).toBeNull();
  });

  it("accepts the GNU binary marker and uppercase hex", () => {
    expect(pickChecksumTarget(`${"A".repeat(64)} *Dani-Dex-0.17.8-x86_64.AppImage\r\n`, "linux")).toEqual({
      name: "Dani-Dex-0.17.8-x86_64.AppImage",
      expected: "a".repeat(64),
    });
  });
});

describe("installer replacement", () => {
  function replace(source: string, dest: string) {
    onboardModule.replaceInstalledPath(source, dest, false);
  }

  it("keeps the existing app when the copy fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "dani-dex-replace-test-"));
    try {
      const dest = join(dir, "Dani-Dex.AppImage");
      writeFileSync(dest, "previous app");
      expect(() => replace(join(dir, "missing"), dest)).toThrow();
      expect(readFileSync(dest, "utf8")).toBe("previous app");
      expect(readdirSync(dir)).toEqual(["Dani-Dex.AppImage"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores the previous app when activation fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "dani-dex-replace-test-"));
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((source, dest) => {
      if (basename(String(source)) === "next") {
        throw new Error("activation failed");
      }
      rename(source, dest);
    });
    try {
      const source = join(dir, "download");
      const dest = join(dir, "Dani-Dex.AppImage");
      writeFileSync(source, "new app");
      writeFileSync(dest, "previous app");
      expect(() => replace(source, dest)).toThrow("activation failed");
      expect(readFileSync(dest, "utf8")).toBe("previous app");
      expect(readdirSync(dir).sort()).toEqual(["Dani-Dex.AppImage", "download"]);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not remove a lock held by another installer", () => {
    const dir = mkdtempSync(join(tmpdir(), "dani-dex-replace-test-"));
    try {
      const dest = join(dir, "Dani-Dex.AppImage");
      fs.mkdirSync(`${dest}.install-lock`);
      writeFileSync(dest, "previous app");
      expect(() => replace(join(dir, "missing"), dest)).toThrow();
      expect(readFileSync(dest, "utf8")).toBe("previous app");
      expect(fs.existsSync(`${dest}.install-lock`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the recovery copy and lock if restoration also fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "dani-dex-replace-test-"));
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((source, dest) => {
      if (["next", "previous"].includes(basename(String(source)))) throw new Error("rename failed");
      rename(source, dest);
    });
    try {
      const source = join(dir, "download");
      const dest = join(dir, "Dani-Dex.AppImage");
      writeFileSync(source, "new app");
      writeFileSync(dest, "previous app");
      expect(() => onboardModule.replaceInstalledPath(source, dest, false)).toThrow("rename failed");
      const staging = readdirSync(dir).find((name) => name.startsWith(".dani-dex-install-"));
      if (!staging) throw new Error("Recovery directory was removed");
      expect(readFileSync(join(dir, staging, "previous"), "utf8")).toBe("previous app");
      expect(fs.existsSync(`${dest}.install-lock`)).toBe(true);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces an app directory only after the full copy is ready", () => {
    const dir = mkdtempSync(join(tmpdir(), "dani-dex-replace-test-"));
    try {
      const source = join(dir, "download.app");
      const dest = join(dir, "Dani-Dex.app");
      fs.mkdirSync(source);
      fs.mkdirSync(dest);
      writeFileSync(join(source, "executable"), "new app");
      writeFileSync(join(dest, "executable"), "previous app");
      onboardModule.replaceInstalledPath(source, dest, true);
      expect(readFileSync(join(dest, "executable"), "utf8")).toBe("new app");
      expect(readdirSync(dir).sort()).toEqual(["Dani-Dex.app", "download.app"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("README", () => {
  it("leads with the single npx command and keeps the no-Node fallbacks", () => {
    const readme = readFileSync(resolve(import.meta.dirname, "..", "README.md"), "utf8");
    expect(readme).toContain("npx dani-dex-onboard");
    expect(readme).toContain("onboard.sh | bash");
    expect(readme).toContain("onboard.ps1 | iex");
  });
});
