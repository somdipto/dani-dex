import { describe, expect, it } from "vitest";
import { hermesLaunch } from "./verify-packaged-hermes";

describe("packaged Hermes launch", () => {
  it("starts the Intel Mac tree under Rosetta and the Windows launcher through cmd.exe, as the app does", () => {
    expect(hermesLaunch("/R/hermes/mac/x64", "darwin", "x86_64", ["--version"])).toEqual({
      command: "arch",
      args: ["-x86_64", "/R/hermes/mac/x64/bin/hermes", "--version"],
      windowsVerbatimArguments: false,
    });
    const windows = hermesLaunch("C:/R/hermes/win/x64", "win32", null, ["acp"]);
    expect(windows.windowsVerbatimArguments).toBe(true);
    expect(windows.args.at(-1)).toContain("hermes.cmd");
    expect(hermesLaunch("/R/hermes/linux/x64", "linux", null, ["acp"]).command).toBe("/R/hermes/linux/x64/bin/hermes");
  });
});
