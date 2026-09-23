import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledHermesExecutable } from "../src/backend/hermes-cli";
import { loadAgentRuntimeLock } from "./agent-runtime-lock";
import { hermesRuntimePath, hermesRuntimeTarget, verifyRequirements } from "./install-hermes-runtime";

describe("bundled Hermes runtime", () => {
  it("pins the requirements file the lock names, including the locked hermes-agent wheel", async () => {
    const lock = await loadAgentRuntimeLock();
    const requirements = await readFile(lock.hermes.requirements);
    expect(() => verifyRequirements(requirements, lock)).not.toThrow();
    expect(() => verifyRequirements(Buffer.concat([requirements, Buffer.from("\nextra==1.0\n")]), lock)).toThrow(
      "does not match the Hermes runtime lock",
    );
  });

  it("stages each target where the app looks for it at run time", () => {
    for (const [platform, architecture] of [
      ["darwin", "arm64"],
      ["darwin", "x64"],
      ["linux", "x64"],
    ] as const) {
      const staged = join(
        hermesRuntimePath("/resources/hermes", hermesRuntimeTarget(platform, architecture)),
        "bin",
        "hermes",
      );
      expect(bundledHermesExecutable(platform, architecture, "/resources")).toBe(staged);
    }
    // Windows reads a `.cmd` launcher, under the same `win/x64` directory the installer stages.
    expect(hermesRuntimePath("/resources/hermes", hermesRuntimeTarget("win32", "x64"))).toBe(
      "/resources/hermes/win/x64",
    );
    expect(bundledHermesExecutable("win32", "x64", "C:\\Resources")).toBe(
      "C:\\Resources\\hermes\\win\\x64\\bin\\hermes.cmd",
    );
  });

  it("refuses a target the lock has no Python for", () => {
    // Failing at build time is the point: an app that shipped without its Hermes tree would only find
    // out when the first agent turn could not start.
    expect(() => hermesRuntimeTarget("linux", "arm64")).toThrow("Unsupported bundled Hermes target: linux-arm64");
  });
});
