// @vitest-environment node
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { UpdateInfo } from "electron-updater";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MacBundleUpdater, pickZip, SWAP_SCRIPT } from "./mac-bundle-updater";

const execFileAsync = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "mac-update-"));
  directories.push(path);
  return path;
}

const ZIP = Buffer.from("PK zip bytes of Dani-Dex 0.17.2");
const sha512 = (bytes: Buffer) => createHash("sha512").update(bytes).digest("base64");

function info(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: "0.17.2",
    releaseDate: "2026-09-25T00:00:00.000Z",
    path: "Dani-Dex-0.17.2-universal.zip",
    sha512: sha512(ZIP),
    files: [
      { url: "Dani-Dex-0.17.2-universal.dmg", sha512: "x", size: 1 },
      { url: "Dani-Dex-0.17.2-universal.zip", sha512: sha512(ZIP), size: ZIP.length },
    ],
    ...overrides,
  };
}

async function updater(options: { bytes?: Buffer; version?: string; verify?: () => void } = {}) {
  const root = await directory();
  const applications = join(root, "Applications");
  await mkdir(join(applications, "Dani-Dex.app"), { recursive: true });
  const fetched: string[] = [];
  const commands: string[][] = [];
  const quit = vi.fn();
  const spawned: string[][] = [];
  const events: string[] = [];
  const subject = new MacBundleUpdater({
    checker: { allowPrerelease: false, checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: info() }) },
    appBundlePath: join(applications, "Dani-Dex.app"),
    releaseDownloadBase: "https://github.com/somdipto/dani-dex/releases/download",
    arch: "x64",
    stagingRoot: join(root, "staging"),
    fetchImpl: async (input) => {
      fetched.push(String(input));
      return new Response(new Uint8Array(options.bytes ?? ZIP), {
        headers: { "content-length": String((options.bytes ?? ZIP).length) },
      });
    },
    run: async (file, args) => {
      commands.push([file, ...args]);
      if (file.endsWith("ditto")) await mkdir(join(args[3] ?? "", "Dani-Dex.app", "Contents"), { recursive: true });
      if (file.endsWith("plutil")) return `${options.version ?? "0.17.2"}\n`;
      if (file.endsWith("codesign")) options.verify?.();
      return "";
    },
    spawnDetached: (file, args) => spawned.push([file, ...args]),
    quit,
    pid: 4242,
  });
  for (const event of ["download-progress", "update-downloaded", "error"]) subject.on(event, () => events.push(event));
  return { subject, fetched, commands, quit, spawned, events, applications };
}

describe("MacBundleUpdater", () => {
  it("picks the universal ZIP, then this architecture's", () => {
    expect(pickZip(info(), "x64").url).toBe("Dani-Dex-0.17.2-universal.zip");
    const split = info({
      files: [
        { url: "Dani-Dex-0.17.2-arm64.zip", sha512: "a", size: 1 },
        { url: "Dani-Dex-0.17.2-x64.zip", sha512: "b", size: 1 },
      ],
    });
    expect(pickZip(split, "x64").url).toBe("Dani-Dex-0.17.2-x64.zip");
    expect(() => pickZip(info({ files: [{ url: "a.dmg", sha512: "", size: 1 }] }), "x64")).toThrow("no Mac ZIP");
  });

  it("downloads the release ZIP, checks it, stages the app, and swaps it in on restart", async () => {
    const { subject, fetched, commands, quit, spawned, events, applications } = await updater();
    await subject.checkForUpdates();
    await subject.downloadUpdate();
    expect(fetched).toEqual([
      "https://github.com/somdipto/dani-dex/releases/download/v0.17.2/Dani-Dex-0.17.2-universal.zip",
    ]);
    expect(commands.map((command) => command[0])).toEqual(["/usr/bin/ditto", "/usr/bin/plutil", "/usr/bin/codesign"]);
    expect(events).toContain("download-progress");
    expect(events.at(-1)).toBe("update-downloaded");

    subject.quitAndInstall();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
    const [shell, script, pid, app, staged] = spawned[0] ?? [];
    expect([shell, pid, app]).toEqual(["/bin/sh", "4242", join(applications, "Dani-Dex.app")]);
    expect(staged?.endsWith("/extracted/Dani-Dex.app")).toBe(true);
    expect(await readFile(script ?? "", "utf8")).toBe(SWAP_SCRIPT);
  });

  it("refuses a download that does not match its published checksum", async () => {
    const { subject, events, commands } = await updater({ bytes: Buffer.from("tampered") });
    await subject.checkForUpdates();
    await expect(subject.downloadUpdate()).rejects.toThrow("does not match its published checksum");
    expect(events.at(-1)).toBe("error");
    expect(commands).toEqual([]);
  });

  it("refuses an app of another version or with a broken signature, and installs nothing", async () => {
    const wrong = await updater({ version: "0.17.1" });
    await wrong.subject.checkForUpdates();
    await expect(wrong.subject.downloadUpdate()).rejects.toThrow("not 0.17.2");
    const broken = await updater({
      verify: () => {
        throw new Error("code object is not signed at all");
      },
    });
    await broken.subject.checkForUpdates();
    await expect(broken.subject.downloadUpdate()).rejects.toThrow("not signed");
    broken.subject.quitAndInstall();
    expect(broken.spawned).toEqual([]);
    expect(broken.quit).not.toHaveBeenCalled();
  });
});

// The script itself, run for real: `open` and `xattr` are stood in by recorders on the PATH.
describe("the swap script", () => {
  async function stage() {
    const root = await directory();
    const bin = join(root, "bin");
    await mkdir(bin);
    for (const tool of ["open", "xattr"]) {
      await writeFile(join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> "${root}/log"\n`);
      await chmod(join(bin, tool), 0o755);
    }
    const app = join(root, "Applications", "Dani-Dex.app");
    const staged = join(root, "staging", "Dani-Dex.app");
    await mkdir(app, { recursive: true });
    await mkdir(staged, { recursive: true });
    await writeFile(join(app, "version"), "0.17.1");
    await writeFile(join(staged, "version"), "0.17.2");
    const script = join(root, "install.sh");
    await writeFile(script, SWAP_SCRIPT, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    return { root, app, staged, script, env };
  }

  it("waits for the app to exit, puts the new bundle in place, and opens it", async () => {
    const { root, app, script, env } = await stage();
    const running = spawn("/bin/sleep", ["30"]);
    const exited = new Promise((resolve) => running.once("exit", resolve));
    const swap = execFileAsync("/bin/sh", [script, String(running.pid), app, join(root, "staging", "Dani-Dex.app")], {
      env,
    });
    // The app is still running, so the script cannot have touched the bundle yet.
    expect(await readFile(join(app, "version"), "utf8")).toBe("0.17.1");
    running.kill();
    await exited;
    await swap;
    expect(await readFile(join(app, "version"), "utf8")).toBe("0.17.2");
    await expect(stat(`${app}.dani-dex-old`)).rejects.toThrow();
    expect(await readFile(join(root, "log"), "utf8")).toBe(`xattr -dr com.apple.quarantine ${app}\nopen ${app}\n`);
  }, 10_000);

  it("puts the old bundle back when the new one cannot be moved in", async () => {
    const { root, app, script, env } = await stage();
    await expect(
      execFileAsync("/bin/sh", [script, "999999", app, join(root, "missing.app")], { env }),
    ).rejects.toThrow();
    expect(await readFile(join(app, "version"), "utf8")).toBe("0.17.1");
    expect(await readFile(join(root, "log"), "utf8")).toBe(`open ${app}\n`);
  });
});
