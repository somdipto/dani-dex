import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundledHermesExecutable,
  HERMES_START_FAILED_MESSAGE,
  HermesStartError,
  parseHermesVersion,
  resolveHermesCli,
} from "./hermes-cli";

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
      executable: managed,
      version: "0.21.4",
      source: "managed",
    });
  });

  it("never tells the user to open a terminal, and keeps the real cause for the log", async () => {
    const root = await mkdtemp(join(tmpdir(), "hermes-cli-"));
    const broken = join(root, "hermes");
    await writeFile(broken, "#!/bin/sh\necho 'ImportError: no module named acp' >&2\nexit 3\n");
    await chmod(broken, 0o755);
    const failure = await resolveHermesCli({ systemCandidates: [], bundledExecutable: broken }).catch((e) => e);
    expect(failure).toBeInstanceOf(HermesStartError);
    expect(failure.message).toBe(HERMES_START_FAILED_MESSAGE);
    expect(failure.message).not.toMatch(/terminal|--version|hermes/iu);
    expect(failure.detail).toContain("ImportError: no module named acp");
    expect(failure.detail).toContain("code 3");
    expect(failure.detail).toContain("attempt 2");
  });

  it("tries a slow first start again instead of giving up", async () => {
    const root = await mkdtemp(join(tmpdir(), "hermes-cli-"));
    const marker = join(root, "started");
    const slow = join(root, "hermes");
    await writeFile(
      slow,
      `#!/bin/sh\nif [ -f '${marker}' ]; then echo 'Hermes Agent v0.19.0'; exit 0; fi\ntouch '${marker}'\nsleep 5\n`,
    );
    await chmod(slow, 0o755);
    await expect(
      resolveHermesCli({ systemCandidates: [], bundledExecutable: slow, timeoutMs: 500 }),
    ).resolves.toMatchObject({ version: "0.19.0", source: "managed" });
  });

  it("names macOS x64 and arm64 paths independently for universal packaging", () => {
    expect(bundledHermesExecutable("darwin", "x64", "/Resources")).toBe("/Resources/hermes/mac/x64/bin/hermes");
    expect(bundledHermesExecutable("darwin", "arm64", "/Resources")).toBe("/Resources/hermes/mac/arm64/bin/hermes");
    expect(bundledHermesExecutable("win32", "x64", "C:\\Resources")).toBe(
      "C:\\Resources\\hermes\\win\\x64\\bin\\hermes.cmd",
    );
  });
});
