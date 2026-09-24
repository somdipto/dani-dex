import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { access, constants, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { isDynamicRecord } from "@dani-dex/contracts/runtime-values";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import type { UpdateAdapter, UpdateCancellationToken, UpdateCheckOutcome } from "./update-service";

const execFileAsync = promisify(execFile);

/**
 * In-place updates for a Mac build without a Developer ID signature.
 *
 * Squirrel.Mac only installs an update that satisfies the running app's designated requirement,
 * which an unsigned or ad-hoc signed app cannot state, so electron-updater finds releases there but
 * can never install one. This adapter keeps electron-updater for the check (it reads the same
 * `latest-mac.yml`) and does the rest itself:
 *
 * 1. downloads the ZIP the metadata names and checks its sha512 against the metadata;
 * 2. extracts it with `ditto` into a staging directory and checks the app inside: its bundle
 *    version is the one announced, and its signature verifies;
 * 3. on restart, hands a small detached script the swap: it waits for Dani-Dex to exit, moves the
 *    new bundle into place (restoring the old one if that fails), clears the download quarantine
 *    and opens the new app.
 *
 * The user presses Update and Restart; nothing is deleted or downloaded by hand.
 */
export interface MacBundleUpdaterOptions {
  /** electron-updater's own updater, used only to read the release metadata. */
  readonly checker: Pick<UpdateAdapter, "checkForUpdates" | "allowPrerelease">;
  /** The running `Dani-Dex.app`. */
  readonly appBundlePath: string;
  /** `https://github.com/<owner>/<repo>/releases/download`. */
  readonly releaseDownloadBase: string;
  readonly arch?: string;
  readonly fetchImpl?: typeof fetch;
  readonly run?: (file: string, args: readonly string[]) => Promise<string>;
  readonly spawnDetached?: (file: string, args: readonly string[]) => void;
  /** Quits the app once the swap script is waiting for it. */
  readonly quit: () => void;
  readonly pid?: number;
  readonly stagingRoot?: string;
}

class CancelledError extends Error {}

export class MacBundleUpdater extends EventEmitter implements UpdateAdapter {
  allowPrerelease = false;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  readonly #options: MacBundleUpdaterOptions;
  #info: UpdateInfo | null = null;
  #staged: string | null = null;

  constructor(options: MacBundleUpdaterOptions) {
    super();
    this.#options = options;
  }

  async checkForUpdates(): Promise<UpdateCheckOutcome | null> {
    this.#options.checker.allowPrerelease = this.allowPrerelease;
    const result = await this.#options.checker.checkForUpdates();
    // The metadata the checker read carries the files and their checksums.
    const info = result?.updateInfo;
    if (result?.isUpdateAvailable && isUpdateInfo(info)) this.#info = info;
    return result;
  }

  async downloadUpdate(cancellationToken?: UpdateCancellationToken): Promise<string[]> {
    const info = this.#info;
    if (!info) throw new Error("No update has been found to download.");
    try {
      const file = pickZip(info, this.#options.arch ?? process.arch);
      await this.#assertWritable();
      const root = await this.#stagingDirectory(info.version);
      const zipPath = join(root, basename(file.url));
      const url = /^https?:\/\//u.test(file.url)
        ? file.url
        : `${this.#options.releaseDownloadBase}/v${encodeURIComponent(info.version)}/${encodeURIComponent(file.url)}`;
      await this.#download(url, zipPath, file.sha512, file.size ?? 0, cancellationToken);
      const extracted = join(root, "extracted");
      await this.#run("/usr/bin/ditto", ["-x", "-k", zipPath, extracted]);
      const app = await findApp(extracted);
      const version = (
        await this.#run("/usr/bin/plutil", [
          "-extract",
          "CFBundleShortVersionString",
          "raw",
          join(app, "Contents", "Info.plist"),
        ])
      ).trim();
      if (version !== info.version) {
        throw new Error(`The downloaded app is version ${version}, not ${info.version}.`);
      }
      await this.#run("/usr/bin/codesign", ["--verify", "--deep", app]);
      this.#staged = app;
      this.emit("update-downloaded", info);
      return [zipPath];
    } catch (error) {
      if (!(error instanceof CancelledError))
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  quitAndInstall(): void {
    const staged = this.#staged;
    if (!staged) {
      this.emit("error", new Error("No downloaded update is ready to install."));
      return;
    }
    const script = join(dirname(dirname(staged)), "install.sh");
    void writeFile(script, SWAP_SCRIPT, { mode: 0o755 })
      .then(() => {
        (this.#options.spawnDetached ?? spawnDetached)("/bin/sh", [
          script,
          String(this.#options.pid ?? process.pid),
          this.#options.appBundlePath,
          staged,
        ]);
        this.#options.quit();
      })
      .catch((error: unknown) => this.emit("error", error instanceof Error ? error : new Error(String(error))));
  }

  /** The bundle is replaced by moving it, so the folder it sits in has to be writable. */
  async #assertWritable(): Promise<void> {
    try {
      await access(dirname(this.#options.appBundlePath), constants.W_OK);
    } catch {
      throw new Error(
        `Dani-Dex can't replace itself in ${dirname(this.#options.appBundlePath)}. Move Dani-Dex to Applications and try again.`,
      );
    }
  }

  async #stagingDirectory(version: string): Promise<string> {
    const parent = this.#options.stagingRoot ?? tmpdir();
    await mkdir(parent, { recursive: true });
    return mkdtemp(join(parent, `dani-dex-update-${version}-`));
  }

  async #download(
    url: string,
    destination: string,
    sha512: string,
    expectedSize: number,
    token: UpdateCancellationToken | undefined,
  ): Promise<void> {
    const response = await (this.#options.fetchImpl ?? fetch)(url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`The update download failed with HTTP ${response.status}.`);
    const total = Number(response.headers.get("content-length")) || expectedSize;
    const hash = createHash("sha512");
    const out = createWriteStream(destination);
    let transferred = 0;
    const started = Date.now();
    try {
      const reader = response.body.getReader();
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        const chunk = read.value;
        if (token?.cancelled) throw new CancelledError("The update download was cancelled.");
        hash.update(chunk);
        transferred += chunk.length;
        if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        const seconds = Math.max((Date.now() - started) / 1000, 0.001);
        const progress: ProgressInfo = {
          total,
          transferred,
          delta: chunk.length,
          percent: total > 0 ? Math.min((transferred / total) * 100, 100) : 0,
          bytesPerSecond: transferred / seconds,
        };
        this.emit("download-progress", progress);
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        out.end((error?: Error | null) => (error ? reject(error) : resolve())),
      );
    }
    if (hash.digest("base64") !== sha512) {
      await rm(destination, { force: true });
      throw new Error("The downloaded update does not match its published checksum.");
    }
  }

  #run(file: string, args: readonly string[]): Promise<string> {
    return (this.#options.run ?? runCommand)(file, args);
  }
}

function isUpdateInfo(value: unknown): value is UpdateInfo {
  return isDynamicRecord(value) && typeof value.version === "string" && Array.isArray(value.files);
}

/** The ZIP for this Mac: the universal one when published, else the one for this architecture. */
export function pickZip(info: UpdateInfo, arch: string): UpdateInfo["files"][number] {
  const zips = info.files.filter((file) => file.url.toLowerCase().endsWith(".zip"));
  const named = (word: string) => zips.find((file) => file.url.toLowerCase().includes(word));
  const file = named("universal") ?? named(arch === "arm64" ? "arm64" : "x64") ?? zips[0];
  if (!file) throw new Error("This release publishes no Mac ZIP to update from.");
  return file;
}

async function findApp(root: string): Promise<string> {
  const app = (await readdir(root)).find((name) => name.endsWith(".app"));
  if (!app) throw new Error("The downloaded update contains no app.");
  return join(root, app);
}

async function runCommand(file: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(file, [...args], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

function spawnDetached(file: string, args: readonly string[]): void {
  spawn(file, [...args], { detached: true, stdio: "ignore" }).unref();
}

/**
 * Waits for the app to exit, swaps the bundle, and opens the new one. A failed move puts the old
 * bundle back, so a broken swap leaves the user with the version they had, never with none.
 * Arguments: <pid> <installed app> <staged app>.
 */
export const SWAP_SCRIPT = `#!/bin/sh
# Dani-Dex in-place update. Generated by src/main/mac-bundle-updater.ts.
pid="$1"; app="$2"; staged="$3"; old="$app.dani-dex-old"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -gt 600 ] && exit 1
  sleep 0.2
done
rm -rf "$old"
if ! mv "$app" "$old"; then open "$app"; exit 1; fi
if ! mv "$staged" "$app"; then mv "$old" "$app"; open "$app"; exit 1; fi
xattr -dr com.apple.quarantine "$app" 2>/dev/null
rm -rf "$old"
open "$app"
`;
