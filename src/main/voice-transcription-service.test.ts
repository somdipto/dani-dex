// @vitest-environment node

import { ChildProcess, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { VoiceModelStatus } from "@dani-dex/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceTranscriptionService } from "./voice-transcription-service";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, execFile: vi.fn() };
});

const ready: VoiceModelStatus = { phase: "ready", progress: 100, message: null };
const roots: string[] = [];
const services: VoiceTranscriptionService[] = [];

beforeEach(() => vi.mocked(execFile).mockReset());
afterEach(async () => {
  for (const service of services.splice(0)) service.shutdown();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dani-dex-transcription-test-"));
  roots.push(root);
  const service = new VoiceTranscriptionService({
    resourcesRoot: root,
    modelPath: join(root, "model.bin"),
    modelDownloadUrl: null,
  });
  services.push(service);
  const prepare = vi.spyOn(service, "prepareModel").mockResolvedValue(ready);
  const child = new ChildProcess();
  const kill = vi.spyOn(child, "kill").mockReturnValue(true);
  vi.mocked(execFile).mockReturnValue(child);
  return { service, prepare, child, kill };
}

function paths() {
  const args = vi.mocked(execFile).mock.calls.at(-1)?.[1];
  if (!Array.isArray(args)) throw new Error("No Whisper invocation.");
  const input = args[args.indexOf("--file") + 1];
  const output = args[args.indexOf("--output-file") + 1];
  if (!input || !output) throw new Error("Whisper paths are missing.");
  return { input, output };
}

describe("local transcription request lifetime", () => {
  it("permits a successful retry when preparation throws and removes recording files", async () => {
    const { service, prepare, child } = await fixture();
    prepare.mockRejectedValueOnce(new Error("Download failed"));
    await expect(service.transcribe(new Uint8Array([1]), "failed-preparation")).rejects.toThrow("could not transcribe");
    const result = service.transcribe(new Uint8Array([2]), "retry");
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledOnce());
    const { input, output } = paths();
    expect(existsSync(input)).toBe(true);
    await writeFile(`${output}.txt`, "  A local task.  ");
    child.emit("exit", 0, null);
    expect(existsSync(input)).toBe(true);
    child.emit("close", 0, null);
    await expect(result).resolves.toEqual({ text: "A local task." });
    expect(existsSync(dirname(input))).toBe(false);
  });

  it("cancels only the matching request and waits for child closure before cleanup or reuse", async () => {
    const { service, child, kill } = await fixture();
    const result = service.transcribe(new Uint8Array([3]), "owned");
    const rejected = expect(result).rejects.toThrow("was cancelled");
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledOnce());
    const { input } = paths();
    service.cancelTranscription("another-window");
    expect(kill).not.toHaveBeenCalled();
    service.cancelTranscription("owned");
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("error", new Error("Aborted"));
    await expect(service.transcribe(new Uint8Array([4]), "too-early")).rejects.toThrow("already in progress");
    expect(existsSync(input)).toBe(true);
    child.emit("close", null, "SIGKILL");
    await rejected;
    expect(existsSync(dirname(input))).toBe(false);
    vi.mocked(execFile).mockClear();
    const retry = service.transcribe(new Uint8Array([5]), "after-close");
    const retryRejected = expect(retry).rejects.toThrow("was cancelled");
    await vi.waitFor(() => expect(execFile).toHaveBeenCalledOnce());
    service.cancelTranscription("after-close");
    child.emit("close", null, "SIGKILL");
    await retryRejected;
  });

  it("releases a cancelled preparation without letting a late completion start inference", async () => {
    const { service, prepare } = await fixture();
    let resolvePreparation: ((status: VoiceModelStatus) => void) | undefined;
    const preparation = new Promise<VoiceModelStatus>((resolve) => {
      resolvePreparation = resolve;
    });
    prepare.mockReturnValueOnce(preparation);
    const result = service.transcribe(new Uint8Array([6]), "preparing");
    const rejected = expect(result).rejects.toThrow("was cancelled");
    service.cancelTranscription("preparing");
    await rejected;
    if (!resolvePreparation) throw new Error("No model preparation resolver.");
    resolvePreparation(ready);
    await preparation;
    expect(execFile).not.toHaveBeenCalled();
    prepare.mockResolvedValueOnce({ phase: "error", progress: null, message: "Try later" });
    await expect(service.transcribe(new Uint8Array([7]), "new-request")).rejects.toThrow("could not transcribe");
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("rejects further requests after shutdown and reports missing runtimes before downloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "dani-dex-missing-runtime-"));
    roots.push(root);
    await mkdir(join(root, "bin"));
    const fetch = vi.fn(async () => new Response());
    const service = new VoiceTranscriptionService({
      resourcesRoot: root,
      modelPath: join(root, "missing-model.bin"),
      modelDownloadUrl: "https://example.invalid/model.bin",
      fetch,
    });
    services.push(service);
    await expect(service.transcribe(new Uint8Array([8]))).rejects.toThrow("could not transcribe");
    expect(fetch).not.toHaveBeenCalled();
    service.shutdown();
    await expect(service.transcribe(new Uint8Array([9]))).rejects.toThrow("stopped");
  });
});
