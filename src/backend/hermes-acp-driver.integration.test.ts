// @vitest-environment node

/*
 * The Hermes harness through a real spawn: Dani-Dex's ACP client drives `hermes acp`, and Hermes
 * calls a local OpenAI-compatible endpoint that stands in for the Layer 2 model provider. Nothing is
 * faked on the Dani-Dex side of the process boundary. Runs only when DANI_DEX_HERMES_TEST_PATH points
 * at a Hermes install, because CI has none yet.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDynamicRecord } from "@dani-dex/contracts/runtime-values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHermesClient, hermesProviderDriver } from "./hermes-acp-driver";
import { resolveHermesCli } from "./hermes-cli";
import type { AppServerNotification } from "./protocol";
import { decodeModelListResponse, decodeRecordResponse } from "./protocol";
import { NO_PROVIDER_CREDENTIALS } from "./provider-drivers";

const hermesPath = process.env.DANI_DEX_HERMES_TEST_PATH?.trim();
const REPLY = "Dani-Dex reached Hermes.";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function modelServer(requests: unknown[]): Promise<Server> {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    if (request.url?.endsWith("/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model", context_length: 200000 }] }),
      );
      return;
    }
    requests.push({ url: request.url, method: request.method, body });
    if (isDynamicRecord(body) && body.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: "mock-model" };
      response.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: REPLY }, finish_reason: null }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "c1",
        object: "chat.completion",
        created: 1,
        model: "mock-model",
        choices: [{ index: 0, message: { role: "assistant", content: REPLY }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe.skipIf(!hermesPath)("Hermes harness over ACP", () => {
  it("reads a computer with no Claude login as signed out, never as an error with terminal advice", async () => {
    const home = await mkdtemp(join(tmpdir(), "dani-dex-empty-home-"));
    const hermesHome = await mkdtemp(join(tmpdir(), "dani-dex-hermes-home-"));
    const cli = await resolveHermesCli({ systemCandidates: [hermesPath ?? ""], bundledExecutable: null });
    const client = createHermesClient("claude", cli, 60_000, NO_PROVIDER_CREDENTIALS, {
      hermesHome,
      extraEnv: () => ({ HOME: home, USERPROFILE: home }),
    });
    client.start();
    cleanups.push(() => client.stop());
    await client.request("initialize", {}, decodeRecordResponse);
    const account = await client.request("account/read", {}, decodeRecordResponse);
    expect(account.account).toBeNull();
  });

  it("signs Claude in from the user's existing Claude Code login and lists Claude models, with no setup", async () => {
    // A computer where the user already ran `claude` and signed in: Claude Code's own credentials
    // file, and a Dani-Dex Hermes home that has never been configured.
    const home = await mkdtemp(join(tmpdir(), "dani-dex-claude-home-"));
    await mkdir(join(home, ".claude"), { recursive: true });
    await writeFile(
      join(home, ".claude", ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-test",
          refreshToken: "sk-ant-ort01-test",
          expiresAt: Date.now() + 3_600_000,
          scopes: ["user:inference"],
        },
      }),
    );
    const hermesHome = await mkdtemp(join(tmpdir(), "dani-dex-hermes-home-"));
    const cli = await resolveHermesCli({ systemCandidates: [hermesPath ?? ""], bundledExecutable: null });
    const client = createHermesClient("claude", cli, 60_000, NO_PROVIDER_CREDENTIALS, {
      hermesHome,
      extraEnv: () => ({ HOME: home, USERPROFILE: home }),
    });
    client.start();
    cleanups.push(() => client.stop());

    await client.request("initialize", {}, decodeRecordResponse);
    const account = await client.request("account/read", {}, decodeRecordResponse);
    expect(account.account).not.toBeNull();
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data.some((model) => /claude/iu.test(model.model ?? ""))).toBe(true);
  });

  it("runs an ordinary Dani-Dex turn through real Hermes and streams the reply back", async () => {
    const requests: unknown[] = [];
    const server = await modelServer(requests);
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The model server has no port.");
    const port = address.port;
    const hermesHome = await mkdtemp(join(tmpdir(), "dani-dex-hermes-home-"));
    await writeFile(
      join(hermesHome, "config.yaml"),
      [
        "model:",
        "  provider: custom",
        `  base_url: http://127.0.0.1:${port}/v1`,
        "  default: mock-model",
        "  api_key: test-key",
        "",
      ].join("\n"),
    );

    const cli = await resolveHermesCli({ systemCandidates: [hermesPath ?? ""], bundledExecutable: null });
    expect(hermesProviderDriver("codex", { hermesHome }).id).toBe("codex");
    const client = createHermesClient("codex", cli, 60_000, NO_PROVIDER_CREDENTIALS, {
      hermesHome,
      inferenceProvider: () => "custom",
      extraEnv: () => ({ OPENAI_API_KEY: "test-key" }),
    });
    const notifications: AppServerNotification[] = [];
    const diagnostics: string[] = [];
    client.on("notification", (notification) => notifications.push(notification));
    client.on("diagnostic", (message) => diagnostics.push(message));
    client.start();
    cleanups.push(() => client.stop());

    await client.request("initialize", {}, decodeRecordResponse);
    const models = await client.request("model/list", {}, decodeModelListResponse);
    expect(models.data.length).toBeGreaterThan(0);

    const workspace = await mkdtemp(join(tmpdir(), "dani-dex-hermes-work-"));
    const thread = await client.request(
      "thread/start",
      { cwd: workspace, runtimeWorkspaceRoots: [workspace] },
      decodeRecordResponse,
    );
    const threadId = isDynamicRecord(thread.thread) ? thread.thread.id : null;
    if (typeof threadId !== "string") throw new Error(`Hermes opened no thread: ${JSON.stringify(thread)}`);

    await client.request(
      "turn/start",
      { threadId, clientUserMessageId: "delivery-1", input: [{ type: "text", text: "Say hello." }] },
      decodeRecordResponse,
    );
    await vi
      .waitFor(
        () => {
          if (!notifications.some((n) => n.method === "turn/completed")) throw new Error("turn still running");
        },
        { timeout: 90_000, interval: 100 },
      )
      .catch(() => {
        throw new Error(
          `No turn/completed. Methods: ${notifications.map((n) => n.method).join(",")}\n${diagnostics.join("\n").slice(-3000)}`,
        );
      });
    const text = JSON.stringify(notifications);
    if (process.env.DANI_DEX_HERMES_TEST_LOG)
      await writeFile(process.env.DANI_DEX_HERMES_TEST_LOG, `${text}\n${diagnostics.join("\n")}`);
    if (!text.includes(REPLY))
      throw new Error(
        `requests=${JSON.stringify(requests).slice(0, 600)}\n${diagnostics
          .filter((d) => /ERROR|WARN|Traceback|prompt|turn|rror/.test(d) && !d.includes("tools.registry"))
          .join("\n")
          .slice(-5000)}`,
      );
    expect(text).toContain(REPLY);
    expect(requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(requests)).toContain("Say hello.");
  }, 150_000);
});
