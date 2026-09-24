// @vitest-environment node

/*
 * Dani's free models end to end: the real Dani-Free proxy starts under a Dani-Dex folder, its model
 * source is set the way the app sets it, and the real OpenCode CLI - through the driver chain the app
 * uses - lists the Dani model from the proxy and nothing behind it. Runs when both
 * DANI_DEX_DANI_FREE_TEST_PATH and DANI_DEX_OPENCODE_TEST_PATH point at real executables.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DaniFreeSupervisor } from "../main/dani-free";
import { harnessDriverResolver } from "./hermes-acp-driver";
import { setRuntimeModelSource } from "./model-source";
import { decodeModelListResponse, decodeRecordResponse } from "./protocol";
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
  it("lists only Dani, served by the bundled proxy, with no account", async () => {
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
    client.start();
    cleanups.push(() => client.stop());

    await client.request("initialize", {}, decodeRecordResponse);
    const models = await client.request("model/list", {}, decodeModelListResponse, 90_000);
    const dani = models.data.filter((model) => model.model?.startsWith("dani/"));
    expect(dani.map((model) => model.model)).toEqual(["dani/auto"]);
    expect(JSON.stringify(dani)).not.toMatch(/kilo|nex|free\)/i);
  }, 180_000);
});
