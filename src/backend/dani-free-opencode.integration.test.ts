// @vitest-environment node

/*
 * Dani's free models end to end: the real Dani-Free proxy starts under a Dani-Dex folder, its model
 * source is set the way the app sets it, and the real OpenCode CLI - through the driver chain the app
 * uses - lists the Dani model from the proxy and nothing behind it, and answers a prompt through it.
 * The prompt goes to the free services on the internet, so this needs a network. Runs when both
 * DANI_DEX_DANI_FREE_TEST_PATH and DANI_DEX_OPENCODE_TEST_PATH point at real executables.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDynamicRecord } from "@dani-dex/contracts/runtime-values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaniFreeSupervisor } from "../main/dani-free";
import { harnessDriverResolver } from "./hermes-acp-driver";
import { setRuntimeModelSource } from "./model-source";
import { type AppServerNotification, decodeModelListResponse, decodeRecordResponse } from "./protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "./provider-drivers";

const proxyPath = process.env.DANI_DEX_DANI_FREE_TEST_PATH?.trim();
const opencodePath = process.env.DANI_DEX_OPENCODE_TEST_PATH?.trim();
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG: process.env.XDG_DATA_HOME };
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  setRuntimeModelSource(null);
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  process.env.XDG_DATA_HOME = saved.XDG;
});

describe.skipIf(!proxyPath || !opencodePath)("Dani's free models through OpenCode", () => {
  it("lists only Dani and answers through the bundled proxy, with no account", async () => {
    const home = await mkdtemp(join(tmpdir(), "dani-dex-dani-free-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.XDG_DATA_HOME;

    const proxy = new DaniFreeSupervisor({ executable: proxyPath ?? "", home: join(home, "dani-free") });
    cleanups.push(() => proxy.stop());
    const source = await proxy.start();
    expect(source).not.toBeNull();
    setRuntimeModelSource(source);

    // With a model source, OpenCode stays on its own CLI so the source is always the one used.
    const driver = harnessDriverResolver("hermes", { hermesHome: join(home, "hermes"), apiKey: () => null })(
      "opencode",
    );
    expect(driver).toBe(requireProviderDriver("opencode"));
    const cli = await driver.resolveCli({ bundledExecutable: opencodePath });
    const client = driver.createClient(cli, 120_000, NO_PROVIDER_CREDENTIALS);
    const notifications: AppServerNotification[] = [];
    client.on("notification", (notification) => notifications.push(notification));
    client.start();
    cleanups.push(() => client.stop());

    await client.request("initialize", {}, decodeRecordResponse);
    const models = await client.request("model/list", {}, decodeModelListResponse, 90_000);
    const dani = models.data.filter((model) => model.model?.startsWith("dani/"));
    expect(dani.map((model) => model.model)).toEqual(["dani/auto"]);
    expect(dani[0]?.displayName).toMatch(/Dani Free Auto$/);
    expect(JSON.stringify(dani)).not.toMatch(/kilo|nex|free\)/i);

    const thread = await client.request(
      "thread/start",
      { cwd: home, runtimeWorkspaceRoots: [home], model: "dani/auto" },
      decodeRecordResponse,
    );
    const threadId = isDynamicRecord(thread.thread) ? thread.thread.id : null;
    if (typeof threadId !== "string") throw new Error(`OpenCode opened no thread: ${JSON.stringify(thread)}`);
    await client.request(
      "turn/start",
      {
        threadId,
        clientUserMessageId: "dani-free-1",
        input: [{ type: "text", text: "Reply with just the word pong, lowercase, nothing else." }],
      },
      decodeRecordResponse,
    );
    await vi.waitFor(
      () => {
        if (!notifications.some((n) => n.method === "turn/completed")) throw new Error("turn still running");
      },
      { timeout: 120_000, interval: 200 },
    );
    const said = JSON.stringify(notifications.filter((n) => n.method !== "turn/completed"));
    expect(said.toLowerCase()).toContain("pong");
    // The upstream service behind "auto" never shows in what the app receives.
    expect(said).not.toMatch(/kilo|nex-agi|openrouter/i);
  }, 180_000);
});
