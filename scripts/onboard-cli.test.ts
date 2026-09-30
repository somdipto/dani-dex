import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { README_INSTALL_ASSETS } from "./verify-readme-install-links";

// `npx dani-dex-onboard` is the single command Som asked for: one literal string that
// runs identically on Windows, macOS and Linux. These tests pin the platform mapping
// to the same release assets the README download buttons ship, and prove the CLI never
// touches the filesystem before the plan is shown.

const cli = resolve(import.meta.dirname, "..", "onboard", "bin", "dani-dex-onboard.js");
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "onboard", "package.json"), "utf8"));

const { pickChecksumTarget } = createRequire(import.meta.url)(
  resolve(import.meta.dirname, "..", "onboard", "bin", "dani-dex-onboard.js"),
) as { pickChecksumTarget: (sumsText: string, platform: string) => { name: string; expected: string } | null };

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
});

describe("README", () => {
  it("leads with the single npx command and keeps the no-Node fallbacks", () => {
    const readme = readFileSync(resolve(import.meta.dirname, "..", "README.md"), "utf8");
    expect(readme).toContain("npx dani-dex-onboard");
    expect(readme).toContain("onboard.sh | bash");
    expect(readme).toContain("onboard.ps1 | iex");
  });
});
