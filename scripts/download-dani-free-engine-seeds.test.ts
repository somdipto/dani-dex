import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadDaniFreeEngineSeeds } from "./download-dani-free-engine-seeds";

const licenseUrl = "https://raw.githubusercontent.com/anomalyco/opencode/v1.18.32/LICENSE";
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const targets = [
  ["darwin-arm64", "opencode-darwin-arm64.zip", "opencode"],
  ["darwin-x64", "opencode-darwin-x64.zip", "opencode"],
  ["linux-x64", "opencode-linux-x64.tar.gz", "opencode"],
  ["win32-x64", "opencode-windows-x64.zip", "opencode.exe"],
] as const;
const archives = new Map<string, Uint8Array>();
const archivePins = new Map<string, string>();
const executablePins = new Map<string, string>();
for (const [target, archive, executable] of targets) {
  const binary = Buffer.alloc(128);
  if (target.startsWith("darwin")) {
    binary.writeUInt32LE(0xfeedfacf, 0);
    binary.writeUInt32LE(target === "darwin-arm64" ? 0x0100000c : 0x01000007, 4);
  } else if (target === "linux-x64") {
    binary.set([0x7f, 0x45, 0x4c, 0x46]);
    binary.writeUInt16LE(0x3e, 18);
  } else {
    binary.write("MZ", 0, "ascii");
    binary.writeUInt32LE(64, 0x3c);
    binary.write("PE\0\0", 64, "ascii");
    binary.writeUInt16LE(0x8664, 68);
  }
  executablePins.set(target, digest(binary));
  // The Linux tar branch is covered by the real pinned upstream download, not this zip fixture.
  if (target === "linux-x64") continue;
  const bytes = zipSync({ [executable]: binary });
  archives.set(archive, bytes);
  archivePins.set(archive, digest(bytes));
}
const created: string[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function fetchFixture(): typeof fetch {
  return vi.fn(async (input) => {
    const url = String(input);
    if (url === licenseUrl) return new Response("wrong-license");
    const name = url.slice(url.lastIndexOf("/") + 1);
    const bytes = archives.get(name);
    if (!bytes) throw new Error(`Unexpected URL: ${url}`);
    return new Response(Buffer.from(bytes));
  });
}

describe("Dani Free engine seed downloads", () => {
  it("rejects incomplete pin sets before fetching upstream", async () => {
    const fetchImpl = fetchFixture();
    await expect(downloadDaniFreeEngineSeeds({ fetchImpl, archivePins, executablePins })).rejects.toThrow(
      "pin set is incomplete",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a changed archive and removes already staged seeds", async () => {
    const output = await mkdtemp(join(tmpdir(), "dani-seeds-test-"));
    created.push(output);
    const pins = new Map(archivePins);
    pins.set("opencode-linux-x64.tar.gz", "0".repeat(64));
    // Reaching Darwin x64 proves the Darwin arm64 copy was first verified and staged.
    const bad = new Map(archives);
    bad.set("opencode-darwin-x64.zip", zipSync({ opencode: Buffer.from("different") }));
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const bytes = bad.get(String(input).split("/").at(-1) ?? "");
      if (!bytes) throw new Error("Unexpected URL");
      return new Response(Buffer.from(bytes));
    });
    await expect(downloadDaniFreeEngineSeeds({ fetchImpl, output, archivePins: pins, executablePins })).rejects.toThrow(
      "archive digest mismatch",
    );
    expect(await readdir(output)).toEqual([]);
  });

  it("rejects valid archive bytes when the executable pin is wrong", async () => {
    const pins = new Map(archivePins);
    pins.set("opencode-linux-x64.tar.gz", "0".repeat(64));
    const executables = new Map(executablePins);
    executables.set("darwin-arm64", "0".repeat(64));
    await expect(
      downloadDaniFreeEngineSeeds({ fetchImpl: fetchFixture(), archivePins: pins, executablePins: executables }),
    ).rejects.toThrow("executable digest mismatch");
  });
});
