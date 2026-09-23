import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledHermesExecutable, parseHermesVersion, resolveHermesCli } from "./hermes-cli";

async function fakeHermes(version: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hermes-cli-"));
  const path = join(root, "hermes");
  await writeFile(path, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
  await chmod(path, 0o755);
  return path;
}

describe("Hermes CLI", () => {
  it("reads the current upstream version shape", () => {
    expect(parseHermesVersion("Hermes Agent v0.21.4\n")).toBe("0.21.4");
    expect(() => parseHermesVersion("development")).toThrow("Unable to read the Hermes version.");
  });

  it("resolves and verifies a managed executable", async () => {
    const managed = await fakeHermes("Hermes Agent v0.21.4");
    await expect(resolveHermesCli({ systemCandidates: [], bundledExecutable: managed })).resolves.toEqual({
      executable: managed, version: "0.21.4", source: "managed",
    });
  });

  it("names macOS x64 and arm64 paths independently for universal packaging", () => {
    expect(bundledHermesExecutable("darwin", "x64", "/Resources")).toBe("/Resources/hermes/mac/x64/bin/hermes");
    expect(bundledHermesExecutable("darwin", "arm64", "/Resources")).toBe("/Resources/hermes/mac/arm64/bin/hermes");
    expect(bundledHermesExecutable("win32", "x64", "C:\\Resources")).toBe("C:\\Resources\\hermes\\win\\x64\\bin\\hermes.exe");
  });
});
