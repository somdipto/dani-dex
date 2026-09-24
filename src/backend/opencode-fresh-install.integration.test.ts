// @vitest-environment node

/*
 * A fresh user picks OpenCode: the pinned runtime is on disk, nothing is signed in, no key is saved,
 * and the default harness is on. The models must appear with no setup. This drives the real driver
 * chain Dani-Dex uses (harness resolver -> driver -> CLI resolve -> ACP client) against the real
 * OpenCode binary, with an empty home. Runs when DANI_DEX_OPENCODE_TEST_PATH points at the pinned
 * `opencode` executable.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { harnessDriverResolver } from "./hermes-acp-driver";
import { decodeModelListResponse, decodeRecordResponse } from "./protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "./provider-drivers";

const opencodePath = process.env.DANI_DEX_OPENCODE_TEST_PATH?.trim();
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG: process.env.XDG_DATA_HOME };
const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  process.env.XDG_DATA_HOME = saved.XDG;
});

describe.skipIf(!opencodePath)("OpenCode on a fresh install", () => {
  it("lists OpenCode's models right after install, with no key and no manual setup", async () => {
    const home = await mkdtemp(join(tmpdir(), "dani-dex-fresh-home-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.XDG_DATA_HOME;

    // The default harness, with nothing saved: OpenCode must run on its own CLI.
    const driver = harnessDriverResolver("hermes", { hermesHome: join(home, "hermes"), apiKey: () => null })(
      "opencode",
    );
    expect(driver).toBe(requireProviderDriver("opencode"));

    const cli = await driver.resolveCli({ bundledExecutable: opencodePath });
    const client = driver.createClient(cli, 90_000, NO_PROVIDER_CREDENTIALS);
    client.start();
    stops.push(() => client.stop());

    await client.request("initialize", {}, decodeRecordResponse);
    const account = await client.request("account/read", {}, decodeRecordResponse);
    expect(account.account).not.toBeNull();
    const models = await client.request("model/list", {}, decodeModelListResponse, 90_000);
    expect(models.data.filter((model) => model.model?.startsWith("opencode/")).length).toBeGreaterThan(0);
  }, 120_000);
});
