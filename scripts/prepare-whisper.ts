import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createDaniDexLogger } from "@dani-dex/logging";

const logger = createDaniDexLogger("prepare-whisper");

const WHISPER_CPP_COMMIT = "86c40c3bd6fc86f1187fb751d111b49e0fc18e84";
const MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";
const MODEL_NAME = "ggml-medium-q5_0.bin";
const MODEL_BYTES = 539_212_467;
const MODEL_SHA256 = "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f";
const buildRoot = resolve(".dani-dex-build/whisper");
const sourceRoot = join(buildRoot, "source");
const cmakeRoot = join(buildRoot, "cmake");
const binaryRoot = join(buildRoot, "bin");
const modelRoot = join(buildRoot, "model");
const modelPath = join(modelRoot, MODEL_NAME);
const executableName = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
const outputExecutable = join(binaryRoot, executableName);
const runtimeOnly = process.argv.includes("--runtime-only");

if (process.platform !== "darwin" && process.platform !== "win32") {
  throw new Error("Voice assets can currently be prepared only on macOS or Windows.");
}

requireCommand("cmake", ["--version"]);
requireCommand("tar", ["--version"]);
await Promise.all([
  mkdir(binaryRoot, { recursive: true }),
  ...(runtimeOnly ? [] : [mkdir(modelRoot, { recursive: true })]),
]);
if (!runtimeOnly) {
  await removeOtherModels();
  await prepareModel();
}
await prepareSource();
buildExecutable();
logger.info(`Prepared Whisper voice assets in ${buildRoot}`);

async function prepareModel(): Promise<void> {
  if (await isExpectedModel()) return;
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/${MODEL_NAME}`;
  logger.info(`Downloading ${MODEL_NAME}…`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to download the Whisper model (${response.status}).`);
  await writeFile(modelPath, Buffer.from(await response.arrayBuffer()));
  if (!(await isExpectedModel())) {
    await rm(modelPath, { force: true });
    throw new Error("The downloaded Whisper model failed its size or SHA-256 check.");
  }
}

async function removeOtherModels(): Promise<void> {
  const entries = await readdir(modelRoot);
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".bin") && entry !== MODEL_NAME)
      .map((entry) => rm(join(modelRoot, entry), { force: true })),
  );
}

async function isExpectedModel(): Promise<boolean> {
  if (!existsSync(modelPath) || (await stat(modelPath)).size !== MODEL_BYTES) return false;
  return (await sha256(modelPath)) === MODEL_SHA256;
}

async function prepareSource(): Promise<void> {
  const marker = join(sourceRoot, ".dani-dex-whisper-commit");
  if (existsSync(marker)) {
    const value = await readFile(marker, "utf8");
    if (value.trim() === WHISPER_CPP_COMMIT) return;
  }
  await Promise.all([
    rm(sourceRoot, { recursive: true, force: true }),
    rm(cmakeRoot, { recursive: true, force: true }),
  ]);
  await mkdir(sourceRoot, { recursive: true });
  const archivePath = join(buildRoot, `${WHISPER_CPP_COMMIT}.tar.gz`);
  const response = await fetch(`https://github.com/ggml-org/whisper.cpp/archive/${WHISPER_CPP_COMMIT}.tar.gz`);
  if (!response.ok) throw new Error(`Unable to download whisper.cpp (${response.status}).`);
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  execFileSync("tar", ["-xzf", archivePath, "--strip-components=1", "-C", sourceRoot], { stdio: "inherit" });
  await Promise.all([writeFile(marker, `${WHISPER_CPP_COMMIT}\n`), rm(archivePath, { force: true })]);
}

/**
 * On macOS the executable is universal: one arm64 build and one x86_64 build joined with `lipo`, so
 * local voice works on Intel Macs as well as Apple Silicon. Each slice is its own CMake build rather
 * than one `CMAKE_OSX_ARCHITECTURES="arm64;x86_64"` build, because ggml picks CPU features per
 * architecture at configure time.
 */
function buildExecutable(): void {
  if (process.platform !== "darwin") {
    copyBuiltExecutable(buildSlice(cmakeRoot, []));
    return;
  }
  const slices = MAC_ARCHITECTURES.map((architecture) =>
    buildSlice(`${cmakeRoot}-${architecture}`, [`-DCMAKE_OSX_ARCHITECTURES=${architecture}`]),
  );
  const universal = join(buildRoot, `${executableName}-universal`);
  execFileSync("lipo", ["-create", ...slices, "-output", universal], { stdio: "inherit" });
  const architectures = execFileSync("lipo", ["-archs", universal], { encoding: "utf8" }).trim().split(/\s+/u);
  for (const architecture of MAC_ARCHITECTURES) {
    if (!architectures.includes(architecture)) {
      throw new Error(`The universal whisper-cli is missing its ${architecture} slice (${architectures.join(", ")}).`);
    }
  }
  copyBuiltExecutable(universal);
}

const MAC_ARCHITECTURES = ["arm64", "x86_64"] as const;

/** Configures and builds one whisper-cli into `buildDirectory` and returns its path. */
function buildSlice(buildDirectory: string, extraArguments: string[]): string {
  execFileSync(
    "cmake",
    [
      "-S",
      sourceRoot,
      "-B",
      buildDirectory,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DGGML_NATIVE=OFF",
      "-DWHISPER_BUILD_TESTS=OFF",
      "-DWHISPER_BUILD_SERVER=OFF",
      ...(process.platform === "win32" ? ["-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded"] : []),
      ...extraArguments,
    ],
    { stdio: "inherit" },
  );
  execFileSync("cmake", ["--build", buildDirectory, "--config", "Release", "--target", "whisper-cli", "-j", "4"], {
    stdio: "inherit",
  });
  const candidates = [
    join(buildDirectory, "bin", executableName),
    join(buildDirectory, "bin", "Release", executableName),
  ];
  const builtExecutable = candidates.find(existsSync);
  if (!builtExecutable) throw new Error(`The whisper.cpp build did not produce ${executableName}.`);
  return builtExecutable;
}

function copyBuiltExecutable(builtExecutable: string): void {
  // Runs the slice this machine can run natively; the other slice is checked by `lipo -archs`.
  execFileSync(builtExecutable, ["--help"], { stdio: "ignore" });
  copyFileSync(builtExecutable, outputExecutable);
  if (process.platform !== "win32") chmodSync(outputExecutable, 0o755);
}

function requireCommand(command: string, arguments_: string[]): void {
  try {
    execFileSync(command, arguments_, { stdio: "ignore" });
  } catch {
    throw new Error(`${basename(command)} is required to prepare local voice transcription assets.`);
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
