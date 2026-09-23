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
  });

  it("refuses a target it cannot launch", () => {
    // Windows needs a native launcher that does not exist yet, so it must fail loudly at build time
    // rather than ship an app whose Hermes harness cannot start.
    expect(() => hermesRuntimeTarget("win32", "x64")).toThrow("Unsupported bundled Hermes target: win32-x64");
  });
});
