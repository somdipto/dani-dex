import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { README_INSTALL_ASSETS } from "./verify-readme-install-links";

// The one-command installers are a public entry point, same as the README download
// buttons: they must resolve every supported platform to a real release asset and
// never touch the filesystem before the user confirms the plan (dry run).

const script = resolve(import.meta.dirname, "onboard.sh");
const powershell = resolve(import.meta.dirname, "onboard.ps1");
const RAW_BASE = "https://raw.githubusercontent.com/somdipto/dani-dex/main/scripts";

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: readonly string[]): RunResult {
  const result = spawnSync("bash", [script, ...args], { encoding: "utf8", env: process.env });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function resolvePlatform(unameS: string, unameM: string): RunResult {
  return run(["--resolve", unameS, unameM]);
}

describe("onboard.sh", () => {
  it("parses under bash -n", () => {
    const result = spawnSync("bash", ["-n", script], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  it("--help prints the paste-able commands and every public flag", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${RAW_BASE}/onboard.sh | bash`);
    expect(result.stdout).toContain(`${RAW_BASE}/onboard.ps1 | iex`);
    for (const flag of ["--no-launch", "--install-dir", "--dry-run"]) {
      expect(result.stdout).toContain(flag);
    }
  });

  it.each([
    ["Darwin", "arm64"],
    ["Darwin", "x86_64"],
  ])("resolves %s/%s to the universal Mac disk image", (unameS, unameM) => {
    const result = resolvePlatform(unameS, unameM);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("platform=macos");
    expect(result.stdout).toContain("asset=Dani-Dex-mac-universal.dmg");
  });

  it.each([
    ["Linux", "x86_64"],
    ["Linux", "amd64"],
  ])("resolves %s/%s to the Linux AppImage", (unameS, unameM) => {
    const result = resolvePlatform(unameS, unameM);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("platform=linux");
    expect(result.stdout).toContain("asset=Dani-Dex-linux-x86_64.AppImage");
  });

  it.each([
    ["MINGW64_NT-10.0-22631", "x86_64"],
    ["MSYS_NT-10.0-22631", "x86_64"],
    ["CYGWIN_NT-10.0-22631", "x86_64"],
  ])("resolves %s to the Windows installer", (unameS, unameM) => {
    const result = resolvePlatform(unameS, unameM);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("platform=windows");
    expect(result.stdout).toContain("asset=Dani-Dex-windows-x64.exe");
  });

  it.each([
    ["Linux", "aarch64"],
    ["Linux", "arm64"],
    ["FreeBSD", "amd64"],
  ])("rejects unsupported %s/%s with a pointer to the releases page", (unameS, unameM) => {
    const result = resolvePlatform(unameS, unameM);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("releases/latest");
  });

  it("only ever resolves assets that the README installer buttons also ship", () => {
    for (const [unameS, unameM] of [
      ["Darwin", "arm64"],
      ["Linux", "x86_64"],
      ["MINGW64_NT-10.0", "x86_64"],
    ] as const) {
      const result = resolvePlatform(unameS, unameM);
      expect(result.status, result.stderr).toBe(0);
      const asset = result.stdout.match(/^asset=(.+)$/m)?.[1];
      expect(asset).toBeDefined();
      expect(README_INSTALL_ASSETS).toContain(asset);
      expect(result.stdout).toContain(`url=https://github.com/somdipto/dani-dex/releases/latest/download/${asset}`);
    }
  });

  it("--dry-run prints the plan and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "dani-dex-onboard-test-"));
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

describe("onboard.ps1", () => {
  it("installs the same Windows asset the README button ships", () => {
    const source = readFileSync(powershell, "utf8");
    expect(source).toContain("Dani-Dex-windows-x64.exe");
    expect(source).toContain("https://github.com/$Repo/releases/latest/download/");
  });
});

describe("README", () => {
  it("carries both one-command installers next to the download buttons", () => {
    const readme = readFileSync(resolve(import.meta.dirname, "..", "README.md"), "utf8");
    expect(readme).toContain(`${RAW_BASE}/onboard.sh | bash`);
    expect(readme).toContain(`${RAW_BASE}/onboard.ps1 | iex`);
  });
});
