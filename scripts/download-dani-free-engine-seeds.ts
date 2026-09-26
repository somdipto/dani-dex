import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { parseSha256Sums } from "./install-dani-free";

const VERSION = "v1.18.32";
const RELEASE = `https://github.com/anomalyco/opencode/releases/download/${VERSION}`;
const LICENSE_URL = `https://raw.githubusercontent.com/anomalyco/opencode/${VERSION}/LICENSE`;
const LICENSE_SHA256 = "625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b";
const TARGETS = [
  { target: "darwin-arm64", archive: "opencode-darwin-arm64.zip", executable: "opencode" },
  { target: "darwin-x64", archive: "opencode-darwin-x64.zip", executable: "opencode" },
  { target: "linux-x64", archive: "opencode-linux-x64.tar.gz", executable: "opencode" },
  { target: "win32-x64", archive: "opencode-windows-x64.zip", executable: "opencode.exe" },
] as const;

/** Fail closed on archive bytes and extracted bytes before the release stager ever sees them. */
export async function downloadDaniFreeEngineSeeds(
  input: {
    fetchImpl?: typeof fetch;
    output?: string;
    archivePins?: Map<string, string>;
    executablePins?: Map<string, string>;
  } = {},
): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const archivePins =
    input.archivePins ?? parseSha256Sums(await readFile(resolve("scripts/dani-free-engine-archives.sha256"), "utf8"));
  const executablePins =
    input.executablePins ?? parseSha256Sums(await readFile(resolve("scripts/dani-free-engine-seeds.sha256"), "utf8"));
  if (archivePins.size !== TARGETS.length || executablePins.size !== TARGETS.length) {
    throw new Error("Dani Free engine seed pin set is incomplete or has extra entries.");
  }
  const output = input.output ?? (await mkdtemp(join(tmpdir(), "dani-free-engine-seeds-")));
  const staged: string[] = [];
  try {
    for (const { target, archive, executable } of TARGETS) {
      const expectedArchive = archivePins.get(archive);
      const expectedBinary = executablePins.get(target);
      if (!expectedArchive || !expectedBinary) throw new Error(`Missing engine seed pin for ${target}.`);
      const response = await fetchImpl(`${RELEASE}/${archive}`, { redirect: "follow" });
      if (!response.ok) throw new Error(`Engine seed ${target} returned HTTP ${response.status}.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== expectedArchive) throw new Error(`Engine seed archive digest mismatch for ${target}.`);
      let binary: Uint8Array;
      if (archive.endsWith(".zip")) {
        const entries = unzipSync(bytes);
        if (Object.keys(entries).length !== 1 || !(executable in entries)) {
          throw new Error(`Unexpected engine seed archive contents for ${target}.`);
        }
        binary = entries[executable];
      } else {
        const temp = await mkdtemp(join(tmpdir(), "dani-free-engine-extract-"));
        try {
          const archivePath = join(temp, archive);
          await writeFile(archivePath, bytes);
          const listing = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" }).trim().split(/\r?\n/u);
          if (listing.length !== 1 || listing[0] !== executable) {
            throw new Error(`Unexpected engine seed archive contents for ${target}.`);
          }
          const detail = execFileSync("tar", ["-tvzf", archivePath], { encoding: "utf8" });
          if (!detail.trimStart().startsWith("-"))
            throw new Error(`Engine seed archive contains a link for ${target}.`);
          binary = execFileSync("tar", ["-xOzf", archivePath, executable], { maxBuffer: 200 * 1024 * 1024 });
        } finally {
          await rm(temp, { recursive: true, force: true });
        }
      }
      if (sha256(binary) !== expectedBinary) throw new Error(`Engine seed executable digest mismatch for ${target}.`);
      verifyExecutableHeader(Buffer.from(binary), target);
      const directory = join(output, target);
      staged.push(directory);
      await mkdir(directory, { recursive: true });
      const destination = join(directory, target === "win32-x64" ? "dani-engine.exe" : "dani-engine");
      await writeFile(destination, binary, { mode: 0o755 });
      await chmod(destination, 0o755);
    }
    const entries = await readdir(output);
    if (entries.length !== TARGETS.length || entries.some((entry) => !TARGETS.some(({ target }) => target === entry))) {
      throw new Error("Unexpected engine seed output files.");
    }
    const licenseResponse = await fetchImpl(LICENSE_URL);
    if (!licenseResponse.ok) throw new Error(`Engine seed license returned HTTP ${licenseResponse.status}.`);
    const license = new Uint8Array(await licenseResponse.arrayBuffer());
    if (sha256(license) !== LICENSE_SHA256) throw new Error("Engine seed license digest mismatch.");
    // The same exact license text is checked in and always copied by the packager.
    // Validation here stops upstream changes or a lost notice from passing unnoticed.
    const checkedInLicense = await readFile(resolve("build/licenses/OpenCode-MIT-LICENSE"));
    if (sha256(checkedInLicense) !== LICENSE_SHA256 || !Buffer.from(checkedInLicense).equals(Buffer.from(license))) {
      throw new Error("Bundled engine seed license is missing or does not match upstream.");
    }
    return output;
  } catch (error) {
    for (const directory of staged) await rm(directory, { recursive: true, force: true });
    if (!input.output) await rm(output, { recursive: true, force: true });
    throw error;
  }
}

function verifyExecutableHeader(bytes: Buffer, target: (typeof TARGETS)[number]["target"]): void {
  if (target.startsWith("darwin")) {
    const machine = target === "darwin-arm64" ? 0x0100000c : 0x01000007;
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== machine) {
      throw new Error(`Engine seed is not a ${target} Mach-O executable.`);
    }
  } else if (target === "linux-x64") {
    if (bytes.length < 20 || bytes.toString("binary", 0, 4) !== "\x7fELF" || bytes.readUInt16LE(18) !== 0x3e) {
      throw new Error("Engine seed is not a linux-x64 ELF executable.");
    }
  } else {
    if (bytes.length < 0x40 || bytes.toString("ascii", 0, 2) !== "MZ") throw new Error("Engine seed is not PE.");
    const offset = bytes.readUInt32LE(0x3c);
    if (
      bytes.length < offset + 6 ||
      bytes.toString("ascii", offset, offset + 4) !== "PE\0\0" ||
      bytes.readUInt16LE(offset + 4) !== 0x8664
    ) {
      throw new Error("Engine seed is not Windows x64 PE.");
    }
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

if (import.meta.main) {
  const directory = await downloadDaniFreeEngineSeeds();
  if (process.env.GITHUB_ENV)
    await writeFile(process.env.GITHUB_ENV, `DANI_FREE_ENGINE_SEEDS_DIR=${directory}\n`, { flag: "a" });
  else process.stdout.write(`${directory}\n`);
}
