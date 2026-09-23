import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledHermesExecutable } from "../src/backend/hermes-cli";
import { loadAgentRuntimeLock } from "./agent-runtime-lock";
import {
  hermesRuntimePath,
  hermesRuntimeTarget,
  prunedRuntimePaths,
  verifyRequirements,
} from "./install-hermes-runtime";

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

  it("prunes Tk and IDLE but keeps pip, which Hermes uses for optional tool dependencies", () => {
    const unix = prunedRuntimePaths("linux-x64", {
      lib: [
        "libpython3.11.so.1.0",
        "libtcl9.0.so",
        "libtcl9tk9.0.so",
        "tcl9.0",
        "tk9.0",
        "itcl4.3.8",
        "thread3.0.6",
        "python3.11",
      ],
      [join("lib", "python3.11", "lib-dynload")]: [
        "_tkinter.cpython-311-x86_64-linux-gnu.so",
        "_ssl.cpython-311-x86_64-linux-gnu.so",
      ],
      bin: ["python3", "python3.11", "pip3", "idle3", "idle3.11", "2to3", "pydoc3.11"],
    });
    expect(unix).toContain(join("python", "lib", "python3.11", "tkinter"));
    expect(unix).toContain(join("python", "lib", "libtcl9tk9.0.so"));
    expect(unix).toContain(join("python", "bin", "idle3.11"));
    expect(unix.some((path) => /libpython|_ssl|pip|python3(?:\.11)?$|ensurepip/u.test(path))).toBe(false);

    const windows = prunedRuntimePaths("win32-x64", {
      DLLs: ["_tkinter.pyd", "tcl86t.dll", "tk86t.dll", "_ssl.pyd", "libcrypto-3.dll"],
      Scripts: ["pip.exe", "idle.exe"],
    });
    expect(windows).toEqual(
      expect.arrayContaining([
        join("python", "tcl"),
        join("python", "DLLs", "tk86t.dll"),
        join("python", "Scripts", "idle.exe"),
      ]),
    );
    expect(windows.some((path) => /_ssl|libcrypto|pip/u.test(path))).toBe(false);
  });
});
