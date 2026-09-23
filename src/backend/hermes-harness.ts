import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type HermesHarnessEvent =
  | { type: "started"; sessionId: string; model: string }
  | { type: "text"; text: string }
  | { type: "tool-started"; name: string; callId: string | null; input: Record<string, unknown> | null }
  | { type: "tool-finished"; name: string; callId: string | null; output: string; failed: boolean }
  | { type: "finished"; sessionId: string; text: string; exitCode: number };

export interface HermesRunInput {
  prompt: string;
  cwd: string;
  model?: string;
  provider?: string;
  resumeSessionId?: string;
  signal?: AbortSignal;
}

interface JsonRecord { [key: string]: unknown }
type SpawnHermes = (executable: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcessWithoutNullStreams;

/**
 * Drives Hermes' documented machine protocol. Prompts go through stdin and stdout must contain
 * JSONL only, so shell syntax in a user request is never interpreted and human formatting is never scraped.
 */
export class HermesHarness {
  constructor(
    private readonly executable: string,
    private readonly spawnProcess: SpawnHermes = spawn as SpawnHermes,
  ) {}

  async *run(input: HermesRunInput): AsyncGenerator<HermesHarnessEvent> {
    if (!input.prompt.trim()) throw new Error("Hermes requires a prompt.");
    const args = ["chat", "--query-file", "-", "--format", "stream-json"];
    if (input.model) args.push("--model", input.model);
    if (input.provider) args.push("--provider", input.provider);
    if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);

    const child = this.spawnProcess(this.executable, args, {
      cwd: input.cwd,
      env: { ...process.env, HERMES_INTERACTIVE: "0", NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const abort = () => child.kill("SIGINT");
    input.signal?.addEventListener("abort", abort, { once: true });
    child.stdin.end(input.prompt);

    let terminal = false;
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });

    try {
      const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
      for await (const line of lines) {
        if (!line.trim()) continue;
        const event = decodeHermesEvent(line);
        if (!event) continue;
        if (event.type === "finished") terminal = true;
        yield event;
      }
      const code = await exitCode(child);
      if (input.signal?.aborted) throw new Error("Hermes run cancelled.");
      if (!terminal || code !== 0) {
        const detail = stderr.trim();
        throw new Error(detail ? `Hermes exited with code ${code}: ${detail}` : `Hermes exited with code ${code}.`);
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
  }
}

export function decodeHermesEvent(line: string): HermesHarnessEvent | null {
  let value: JsonRecord;
  try {
    value = JSON.parse(line) as JsonRecord;
  } catch {
    throw new Error("Hermes emitted invalid JSONL.");
  }
  switch (value.type) {
    case "system":
      return value.subtype === "init"
        ? { type: "started", sessionId: stringValue(value.session_id), model: stringValue(value.model) }
        : null;
    case "text":
      return { type: "text", text: stringValue(value.text) };
    case "tool_use":
      return {
        type: "tool-started",
        name: stringValue(value.name),
        callId: nullableString(value.tool_call_id),
        input: isRecord(value.input) ? value.input : null,
      };
    case "tool_result":
      return {
        type: "tool-finished",
        name: stringValue(value.name),
        callId: nullableString(value.tool_call_id),
        output: stringValue(value.output),
        failed: value.is_error === true,
      };
    case "result":
      return {
        type: "finished",
        sessionId: stringValue(value.session_id),
        text: stringValue(value.text),
        exitCode: numberValue(value.exit_code),
      };
    default:
      return null;
  }
}

function exitCode(child: ChildProcessWithoutNullStreams): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function numberValue(value: unknown): number { return typeof value === "number" && Number.isInteger(value) ? value : 1; }
