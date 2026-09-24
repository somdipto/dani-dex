import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { HERMES_DOCTOR_MARKER, HERMES_SIDE_TASK_PROVIDER, repairHermesHome } from "./hermes-repair";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "hermes-home-"));
  directories.push(path);
  return path;
}

/** Does what the real doctor does to a state directory: writes the files that are missing. */
function fakeDoctor() {
  return vi.fn(async (_executable: string, hermesHome: string) => {
    const existing = await readdir(hermesHome);
    if (!existing.includes(".env")) await writeFile(join(hermesHome, ".env"), "");
    if (!existing.includes("config.yaml")) await writeFile(join(hermesHome, "config.yaml"), "_config_version: 33\n");
    return "Fixed 2 issue(s).";
  });
}

describe("repairHermesHome", () => {
  it("runs the doctor once per Hermes version, then leaves a healthy state alone", async () => {
    const hermesHome = await home();
    const runDoctor = fakeDoctor();
    const input = { executable: "/app/hermes", version: "0.19.0", hermesHome, runDoctor };

    await expect(repairHermesHome(input)).resolves.toBe("repaired");
    await expect(repairHermesHome(input)).resolves.toBe("healthy");
    expect(runDoctor).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(join(hermesHome, HERMES_DOCTOR_MARKER), "utf8"))).toEqual({ version: "0.19.0" });

    await expect(repairHermesHome({ ...input, version: "0.20.0" })).resolves.toBe("healthy");
    expect(runDoctor).toHaveBeenCalledTimes(2);
  });

  // Hermes falls back to defaults on a config it cannot parse and warns on every start, and its
  // doctor does not replace the file. Moving it aside is what lets the doctor write a fresh one.
  it("moves an unreadable config aside so the doctor writes a fresh one", async () => {
    const hermesHome = await home();
    const runDoctor = fakeDoctor();
    await repairHermesHome({ executable: "/app/hermes", version: "0.19.0", hermesHome, runDoctor });
    await writeFile(join(hermesHome, "config.yaml"), "model: [unclosed\n  : :\n");

    await expect(
      repairHermesHome({ executable: "/app/hermes", version: "0.19.0", hermesHome, runDoctor }),
    ).resolves.toBe("repaired");
    expect(await readFile(join(hermesHome, "config.yaml"), "utf8")).toMatch(/^_config_version: 33\n/);
    expect((await readdir(hermesHome)).some((name) => name.startsWith("config.yaml.dani-dex-reset-"))).toBe(true);
  });

  it("never throws, and does not mark a state the doctor could not fix", async () => {
    const hermesHome = await home();
    const failing = vi.fn(async () => {
      throw new Error("spawn EACCES");
    });
    await expect(
      repairHermesHome({ executable: "/app/hermes", version: "0.19.0", hermesHome, runDoctor: failing }),
    ).resolves.toBe("failed");
    const idle = vi.fn(async () => "nothing fixed");
    await expect(
      repairHermesHome({ executable: "/app/hermes", version: "0.19.0", hermesHome, runDoctor: idle }),
    ).resolves.toBe("failed");
    expect(await readdir(hermesHome)).not.toContain(HERMES_DOCTOR_MARKER);
  });
});

/*
 * The real Hermes doctor, on the state shapes that broke starts: an empty directory and a config it
 * cannot parse. Runs when DANI_DEX_HERMES_TEST_PATH points at the bundled `hermes`.
 */
const hermesPath = process.env.DANI_DEX_HERMES_TEST_PATH?.trim();
describe("side-task provider", () => {
  it("names the chat's provider for side tasks and keeps everything else in the config", async () => {
    const hermesHome = await home();
    await writeFile(join(hermesHome, ".env"), "");
    await writeFile(join(hermesHome, "config.yaml"), "_config_version: 33\n\n# Security notes stay.\n");
    await expect(
      repairHermesHome({ executable: "hermes", version: "0.19.0", hermesHome, runDoctor: fakeDoctor() }),
    ).resolves.toBe("healthy");
    const config = await readFile(join(hermesHome, "config.yaml"), "utf8");
    expect(config).toContain("_config_version: 33");
    expect(config).toContain("# Security notes stay.");
    expect(parse(config).model).toEqual({ provider: HERMES_SIDE_TASK_PROVIDER });
    expect(config).not.toContain("default:");
  });

  it("leaves a provider the config already names", async () => {
    const hermesHome = await home();
    await writeFile(join(hermesHome, ".env"), "");
    await writeFile(join(hermesHome, "config.yaml"), "model:\n  provider: anthropic\n  default: claude-sonnet-5\n");
    await repairHermesHome({ executable: "hermes", version: "0.19.0", hermesHome, runDoctor: fakeDoctor() });
    expect(await readFile(join(hermesHome, "config.yaml"), "utf8")).toBe(
      "model:\n  provider: anthropic\n  default: claude-sonnet-5\n",
    );
  });
});

describe.skipIf(!hermesPath)("repairHermesHome with the bundled Hermes", () => {
  it("leaves an empty or corrupted state directory in a shape Hermes starts from", async () => {
    const hermesHome = await home();
    const input = { executable: hermesPath ?? "", version: "0.19.0", hermesHome };
    await expect(repairHermesHome(input)).resolves.toBe("repaired");
    expect(await readdir(hermesHome)).toEqual(expect.arrayContaining([".env", "config.yaml", HERMES_DOCTOR_MARKER]));

    await writeFile(join(hermesHome, "config.yaml"), "model: [unclosed\n  : :\n");
    await expect(repairHermesHome(input)).resolves.toBe("repaired");
    expect(await readFile(join(hermesHome, "config.yaml"), "utf8")).toContain("_config_version");
  }, 120_000);
});
