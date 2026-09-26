// The bundled Dani-Free proxy: Dani's free models, served on this computer.
//
// `dani-free start` runs as a child of the app for as long as the app runs. It prints one line,
// `DANI_FREE_READY {"baseUrl","port","pid","apiKeyFile","privateMode"}`, once it listens; the key it
// minted for this install is in `apiKeyFile`. From that line and `GET /v1/models` this module builds
// the model source OpenCode agents use, named "Dani" throughout: the upstream services and model
// names behind the proxy never reach the interface.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { DaniDexModelSource } from "@dani-dex/contracts/online-services";
import { isDynamicRecord } from "@dani-dex/contracts/runtime-values";
import { createDaniDexLogger, redactText } from "@dani-dex/logging";
import { appendDaniFreeDiagnostic, type DaniFreeStage } from "./dani-free-diagnostic";

const logger = createDaniDexLogger("dani-free");

export const DANI_FREE_READY_PREFIX = "DANI_FREE_READY ";
export const DANI_FREE_READY_TIMEOUT_MS = 30_000;
export const DANI_FREE_REQUEST_TIMEOUT_MS = 20_000;
export const DANI_MODEL_SOURCE_ID = "dani";
export const DANI_MODEL_SOURCE_NAME = "Dani";
/** The model the proxy routes itself, and the only one the interface shows. */
export const DANI_AUTO_MODEL = "dani-free-auto";
/** What the user sees for it, the only model name in the product. */
export const DANI_AUTO_MODEL_NAME = "Dani Free Auto";

export interface DaniFreeReady {
  readonly baseUrl: string;
  readonly port: number;
  readonly pid: number;
  readonly apiKeyFile: string;
  readonly privateMode: boolean;
}

/** The ready line's contents, or null for any other line. */
export function parseDaniFreeReadyLine(line: string): DaniFreeReady | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(DANI_FREE_READY_PREFIX)) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed.slice(DANI_FREE_READY_PREFIX.length));
  } catch {
    return null;
  }
  if (!isDynamicRecord(value)) return null;
  const { baseUrl, port, pid, apiKeyFile, privateMode } = value;
  if (typeof baseUrl !== "string" || !/^http:\/\/127\.0\.0\.1:\d+(?:\/|$)/.test(baseUrl)) {
    return null;
  }
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    typeof pid !== "number" ||
    !Number.isInteger(pid) ||
    pid < 1 ||
    typeof apiKeyFile !== "string" ||
    !apiKeyFile
  )
    return null;
  const url = new URL(baseUrl);
  if (
    url.port !== String(port) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/v1", "/v1/"].includes(url.pathname)
  )
    return null;
  // The proxy reports its OpenAI base (`.../v1`); this keeps the origin, and the paths below add it.
  return {
    baseUrl: baseUrl.replace(/\/+$/, "").replace(/\/v1$/, ""),
    port,
    pid,
    apiKeyFile,
    privateMode: privateMode === true,
  };
}

/** `<resources>/dani-free/<platform>/<arch>/dani-free[.exe]`, or null when this build has none. */
export function bundledDaniFreeExecutable(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  const path = join(resourcesPath, "dani-free", platform, arch, platform === "win32" ? "dani-free.exe" : "dani-free");
  return existsSync(path) ? path : null;
}

/**
 * The model source for OpenCode. Only the proxy's own routing model is listed, as "Dani Free Auto": the models
 * behind it change with the free services the proxy finds, and their names are not the product.
 */
export function buildDaniModelSource(
  ready: DaniFreeReady,
  key: string,
  modelIds: readonly string[],
): DaniDexModelSource {
  if (modelIds.length !== 1 || modelIds[0] !== DANI_AUTO_MODEL) {
    throw new Error("Dani Free did not return its single supported model.");
  }
  const id = DANI_AUTO_MODEL;
  return {
    id: DANI_MODEL_SOURCE_ID,
    name: DANI_MODEL_SOURCE_NAME,
    baseUrl: `${ready.baseUrl}/v1`,
    models: [{ id, name: DANI_AUTO_MODEL_NAME }],
    headers: [{ name: "x-api-key", value: key }],
    apiKey: key,
  };
}

export interface DaniFreeOptions {
  readonly executable: string;
  /** Dani-Dex's own folder for the proxy's key, catalog and runtime file (`DANI_FREE_HOME`). */
  readonly home: string;
  /** Extra environment for the proxy, for tests. */
  readonly env?: Readonly<Record<string, string>>;
  readonly privateMode?: boolean;
  readonly engineSeed?: { readonly executable: string; readonly sha256: string };
  readonly readyTimeoutMs?: number;
  readonly fetch?: typeof fetch;
  readonly spawnProcess?: typeof spawn;
}

/**
 * Starts the proxy, waits for its ready line, and stops it with the app. One instance per app run.
 * `start` never throws for an ordinary failure: it resolves null, the proxy's last words go to the
 * log, and OpenCode keeps its own catalog.
 */
export class DaniFreeSupervisor {
  readonly #options: DaniFreeOptions;
  #child: ChildProcess | null = null;
  #stopping = false;

  constructor(options: DaniFreeOptions) {
    this.#options = options;
  }

  async start(): Promise<DaniDexModelSource | null> {
    let stage: DaniFreeStage = "spawn";
    try {
      await this.sweepLeftovers();
      stage = "ready";
      const ready = await this.#spawn();
      stage = "key";
      if (ready.pid !== this.#child?.pid) throw new Error("Dani Free process identity did not match.");
      if (
        !isAbsolute(ready.apiKeyFile) ||
        !withinHome(await realpath(this.#options.home), await realpath(ready.apiKeyFile))
      ) {
        throw new Error("Dani Free key path is outside its private home.");
      }
      const key = await readKey(ready.apiKeyFile);
      // No refresh nudge: the proxy probes and refreshes on its own, and a refresh can take 20s+.
      stage = "models";
      const models = await this.#request(ready, key, "GET", "/v1/models");
      const ids =
        isDynamicRecord(models) && Array.isArray(models.data)
          ? models.data.flatMap((entry) => (isDynamicRecord(entry) && typeof entry.id === "string" ? [entry.id] : []))
          : [];
      const source = buildDaniModelSource(ready, key, ids);
      logger.info("Dani-Free is ready.", { port: ready.port, models: ids.length, privateMode: ready.privateMode });
      await appendDaniFreeDiagnostic(this.#options.home, { stage: "connected", outcome: "ready" }).catch(
        () => undefined,
      );
      return source;
    } catch (error) {
      logger.warn("Dani-Free did not start.", { error: describe(error) });
      await appendDaniFreeDiagnostic(this.#options.home, { stage, outcome: "failed", detail: describe(error) }).catch(
        () => undefined,
      );
      await this.stop();
      return null;
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    this.#child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      if (child?.pid) this.#signalGroup(child.pid, "SIGTERM");
      return;
    }
    this.#stopping = true;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (process.platform === "win32") child.kill();
    else this.#signalGroup(child.pid, "SIGTERM");
    const timer = setTimeout(() => {
      if (process.platform === "win32") child.kill("SIGKILL");
      else this.#signalGroup(child.pid, "SIGKILL");
    }, 3_000);
    await exited;
    clearTimeout(timer);
    // Whatever the proxy started and left behind in its group goes with it.
    if (child.pid) this.#signalGroup(child.pid, "SIGTERM");
    await rm(this.#groupFile(), { force: true }).catch(() => undefined);
  }

  /**
   * Stops what a previous run left behind. If Dani-Dex and the proxy are both force-killed, the
   * OpenCode the proxy ran can outlive them in the proxy's process group. The group id is recorded
   * at spawn, and the next launch ends that group before starting a new proxy. A process group id is
   * not handed out again while any member of the group is alive, so a group that still exists under
   * that id is the one left behind.
   */
  async sweepLeftovers(): Promise<void> {
    if (process.platform === "win32") return;
    const recorded = await readFile(this.#groupFile(), "utf8").catch(() => "");
    const group = Number.parseInt(recorded.trim(), 10);
    if (Number.isInteger(group) && group > 1 && group !== process.pid) {
      if (this.#signalGroup(group, "SIGTERM")) logger.info("Stopped what the last Dani-Free run left running.");
    }
    await rm(this.#groupFile(), { force: true }).catch(() => undefined);
  }

  #groupFile(): string {
    return join(this.#options.home, "dani-dex-process-group");
  }

  async #recordGroup(group: number): Promise<void> {
    await mkdir(this.#options.home, { recursive: true });
    await writeFile(this.#groupFile(), `${group}\n`, { mode: 0o600 }).catch(() => undefined);
  }

  /** Signals a whole process group; false when there is none. */
  #signalGroup(group: number | undefined, signal: NodeJS.Signals): boolean {
    if (!group || process.platform === "win32") return false;
    try {
      process.kill(-group, signal);
      return true;
    } catch {
      return false;
    }
  }

  #spawn(): Promise<DaniFreeReady> {
    const spawnProcess = this.#options.spawnProcess ?? spawn;
    const child = spawnProcess(this.#options.executable, ["start"], {
      env: {
        ...process.env,
        DANI_FREE_HOME: this.#options.home,
        // Any free port, on 127.0.0.1: the ready line says which.
        DANI_FREE_PORT: "0",
        DANI_FREE_HOST: "127.0.0.1",
        ...(this.#options.engineSeed
          ? {
              DANI_FREE_ENGINE_SEED_BIN: this.#options.engineSeed.executable,
              DANI_FREE_ENGINE_SEED_SHA256: this.#options.engineSeed.sha256,
            }
          : {}),
        // The proxy exits within about two seconds of this process going away, on every platform,
        // so a crash or a force-quit never leaves it running.
        DANI_FREE_PARENT_PID: String(process.pid),
        DANI_FREE_PRIVATE_MODE: this.#options.privateMode ? "1" : "0",
        ...this.#options.env,
        DANI_FREE_ENGINE_AUTOUPDATE: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // Its own process group on macOS and Linux, so the OpenCode it runs can be stopped with it.
      detached: process.platform !== "win32",
    });
    this.#child = child;
    if (child.pid && process.platform !== "win32") void this.#recordGroup(child.pid);
    this.#stopping = false;
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on("exit", (code, signal) => {
      if (!this.#stopping) {
        logger.warn("Dani-Free exited.", { code, signal, stderr: redactText(stderr) });
        void appendDaniFreeDiagnostic(this.#options.home, {
          stage: "exit",
          outcome: "exited",
          code,
          signal,
        }).catch(() => undefined);
      }
    });
    return new Promise<DaniFreeReady>((resolve, reject) => {
      let buffer = "";
      let settled = false;
      const finish = (error: Error | null, ready?: DaniFreeReady) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (ready) resolve(ready);
      };
      const timer = setTimeout(
        () => finish(new Error("Dani-Free did not report ready in time.")),
        this.#options.readyTimeoutMs ?? DANI_FREE_READY_TIMEOUT_MS,
      );
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const ready = parseDaniFreeReadyLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          if (ready) finish(null, ready);
          newline = buffer.indexOf("\n");
        }
      });
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) =>
        finish(
          new Error(`Dani-Free exited before it was ready (${signal ?? code}): ${redactText(stderr.slice(-400))}`),
        ),
      );
    });
  }

  async #request(ready: DaniFreeReady, key: string, method: "GET" | "POST", path: string): Promise<unknown> {
    const response = await (this.#options.fetch ?? fetch)(`${ready.baseUrl}${path}`, {
      method,
      headers: { "x-api-key": key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(DANI_FREE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}.`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}

async function readKey(path: string): Promise<string> {
  if (process.platform !== "win32") {
    const mode = (await stat(path)).mode & 0o777;
    // The proxy writes it 600. A wider file is still read - refusing would only turn the free models
    // off - but it is worth a line in the log.
    if (mode & 0o077) logger.warn("The Dani-Free key file is readable by other users.", { mode: mode.toString(8) });
  }
  const key = (await readFile(path, "utf8")).trim();
  if (!key) throw new Error("The Dani-Free key file is empty.");
  return key;
}

function describe(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

function withinHome(home: string, target: string): boolean {
  const path = relative(resolve(home), resolve(target));
  return (
    Boolean(path) &&
    path !== ".." &&
    !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(path)
  );
}
