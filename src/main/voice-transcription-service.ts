import { type ChildProcess, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import type { VoiceModelStatus, VoiceTranscriptionResult } from "@dani-dex/contracts/ipc";
import { isString } from "@dani-dex/contracts/runtime-values";
import { createDaniDexLogger } from "@dani-dex/logging";
import { VoiceModelService } from "./voice-model-service";

const logger = createDaniDexLogger("voice-transcription-service");

const TRANSCRIPTION_TIMEOUT_MS = 180_000;

interface VoiceTranscriptionEvents {
  modelStatus: [status: VoiceModelStatus];
}

/**
 * Missing runtime is reported before any model download. All supported packages must carry the
 * matching executable; a model download cannot repair a missing native runtime.
 */
const RUNTIME_UNAVAILABLE_MESSAGE = "Local voice transcription is not available on this platform.";

interface VoiceTranscriptionServiceOptions {
  resourcesRoot: string;
  modelPath: string;
  modelDownloadUrl: string | null;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export class VoiceTranscriptionService extends EventEmitter<VoiceTranscriptionEvents> {
  private activeChild: ChildProcess | null = null;
  private activeRequest: { id: string; controller: AbortController } | null = null;
  private stopped = false;
  private readonly executable: string;
  private readonly model: VoiceModelService;

  constructor(options: VoiceTranscriptionServiceOptions) {
    super();
    this.executable = join(
      options.resourcesRoot,
      "bin",
      process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli",
    );
    this.model = new VoiceModelService({
      modelPath: options.modelPath,
      downloadUrl: options.modelDownloadUrl,
      fetch: options.fetch,
    });
    this.model.on("status", (status) => this.emit("modelStatus", status));
  }

  getModelStatus(): Promise<VoiceModelStatus> {
    return this.runtimeMissing() ?? this.model.getStatus();
  }

  prepareModel(): Promise<VoiceModelStatus> {
    return this.runtimeMissing() ?? this.model.prepare();
  }

  async transcribe(audio: Uint8Array, requestId: string = randomUUID()): Promise<VoiceTranscriptionResult> {
    if (this.stopped) throw new Error("Voice transcription is stopped.");
    if (this.activeRequest) throw new Error("A voice transcription is already in progress.");
    const request = { id: requestId, controller: new AbortController() };
    this.activeRequest = request;
    let temporaryRoot: string | undefined;
    const startedAt = Date.now();
    try {
      const modelStatus = await this.prepareModelForRequest(request.controller.signal);
      request.controller.signal.throwIfAborted();
      if (modelStatus.phase !== "ready") throw new Error(modelStatus.message ?? "The voice model is unavailable.");
      const model = this.model.modelPath;
      temporaryRoot = await mkdtemp(join(tmpdir(), "dani-dex-voice-"));
      const inputPath = join(temporaryRoot, "recording.wav");
      const outputPath = join(temporaryRoot, "transcript");
      await writeFile(inputPath, audio, { mode: 0o600 });
      request.controller.signal.throwIfAborted();
      await this.run(
        this.executable,
        [
          "--model",
          model,
          "--file",
          inputPath,
          "--language",
          "auto",
          "--output-txt",
          "--output-file",
          outputPath,
          "--no-timestamps",
          "--no-gpu",
          "--threads",
          "4",
        ],
        request.controller.signal,
      );
      request.controller.signal.throwIfAborted();
      const text = (await readFile(`${outputPath}.txt`, "utf8")).trim();
      request.controller.signal.throwIfAborted();
      if (text.length > INPUT_LIMITS.messageText) throw new Error("The voice transcript is too long.");
      logger.info(`Voice transcription completed in ${Date.now() - startedAt}ms.`);
      return { text };
    } catch (error) {
      if (request.controller.signal.aborted) throw new Error("Voice transcription was cancelled.");
      logger.error(`Voice transcription failed after ${Date.now() - startedAt}ms.`, errorCategory(error));
      throw userFacingError(error);
    } finally {
      try {
        if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
      } finally {
        this.activeChild = null;
        if (this.activeRequest === request) this.activeRequest = null;
      }
    }
  }

  cancelTranscription(requestId: string): void {
    if (this.activeRequest?.id !== requestId) return;
    this.activeRequest.controller.abort();
    this.activeChild?.kill("SIGKILL");
  }

  shutdown(): void {
    this.stopped = true;
    this.activeRequest?.controller.abort();
    this.model.shutdown();
    this.activeChild?.kill("SIGKILL");
  }

  /**
   * The error status for a build with no whisper binary, or `null` when one is present. Returned as
   * a resolved promise so the callers stay one-liners over the model service they otherwise wrap.
   */
  private runtimeMissing(): Promise<VoiceModelStatus> | null {
    if (existsSync(this.executable)) return null;
    const status: VoiceModelStatus = { phase: "error", progress: null, message: RUNTIME_UNAVAILABLE_MESSAGE };
    this.emit("modelStatus", status);
    return Promise.resolve(status);
  }

  /** Cancel this request without stopping preparation shared by other voice callers. */
  private prepareModelForRequest(signal: AbortSignal): Promise<VoiceModelStatus> {
    return new Promise((resolve, reject) => {
      const cancelled = () => reject(new Error("Voice transcription was cancelled."));
      signal.addEventListener("abort", cancelled, { once: true });
      this.prepareModel()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", cancelled));
    });
  }

  private run(executable: string, arguments_: string[], signal: AbortSignal): Promise<void> {
    return new Promise((resolveRun, rejectRun) => {
      const child = execFile(executable, arguments_, { windowsHide: true, signal, killSignal: "SIGKILL" });
      this.activeChild = child;
      let stderr = "";
      let failure: Error | undefined;
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-4_000);
      });
      const timer = setTimeout(() => {
        failure = new Error("Voice transcription timed out.");
        child.kill("SIGKILL");
      }, TRANSCRIPTION_TIMEOUT_MS);
      child.once("error", (error) => {
        failure = error;
      });
      child.once("close", (code, terminationSignal) => {
        clearTimeout(timer);
        if (failure) rejectRun(failure);
        else if (code === 0) resolveRun();
        else
          rejectRun(new Error(`Whisper exited with ${terminationSignal ?? `code ${String(code)}`}: ${stderr.trim()}`));
      });
    });
  }
}

function errorCategory(error: unknown): "unknown" | "runtime-unavailable" | "timeout" | "inference-failed" {
  if (!(error instanceof Error)) return "unknown";
  if (errorCode(error) === "ENOENT") return "runtime-unavailable";
  if (error.message.includes("timed out")) return "timeout";
  return "inference-failed";
}

function userFacingError(error: unknown): Error {
  if (error instanceof Error && error.message.includes("timed out")) return error;
  if (error instanceof Error && errorCode(error) === "ENOENT") {
    return new Error("Local voice transcription is unavailable. Run `bun run voice:prepare` and restart Dani-Dex.");
  }
  return new Error("Dani-Dex could not transcribe this recording.");
}

function errorCode(error: Error): string | undefined {
  const code = "code" in error ? error.code : undefined;
  return isString(code) ? code : undefined;
}
