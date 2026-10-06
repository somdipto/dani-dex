#!/usr/bin/env node

/*
 * Dani-Dex one-command onboarding.
 *
 *   npx dani-dex-onboard
 *
 * The same single command on Windows, macOS and Linux: it detects the platform,
 * downloads the newest Dani-Dex release from GitHub, installs it and opens the
 * app so onboarding starts. Needs Node.js (https://nodejs.org) - npm and npx
 * ship with it.
 *
 * Options:
 *   --no-launch            install only, do not open the app at the end
 *   --install-dir <path>   where to put the app (default: /Applications or
 *                          ~/Applications on macOS, ~/Applications on Linux)
 *   --dry-run              print the plan and stop before any download or change
 *   --help                 show this help
 */
const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const REPO = "somdipto/dani-dex";
const RELEASE_ROOT = process.env.DANI_DEX_ONBOARD_RELEASE_ROOT || `https://github.com/${REPO}/releases/latest/download`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

const TTY = process.stdout.isTTY;
const C = TTY
  ? { bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", reset: "\x1b[0m" }
  : { bold: "", dim: "", green: "", red: "", yellow: "", reset: "" };

const say = (msg = "") => process.stdout.write(`${msg}\n`);
const step = (msg) => say(`${C.bold}==>${C.reset} ${msg}`);
const ok = (msg) => say(`${C.green} ok ${C.reset} ${msg}`);
const warn = (msg) => process.stderr.write(`${C.yellow}warn${C.reset} ${msg}\n`);
const die = (msg) => {
  throw new Error(msg);
};

function banner() {
  say("Dani-Dex setup");
}

function usage() {
  say(`Dani-Dex one-command onboarding.

  npx dani-dex-onboard

The same single command on Windows, macOS and Linux: it detects the platform,
downloads the newest Dani-Dex release from GitHub, installs it and opens the
app so onboarding starts. Needs Node.js (https://nodejs.org).

Options:
  --no-launch            install only, do not open the app at the end
  --install-dir <path>   where to put the app (default: /Applications or
                         ~/Applications on macOS, ~/Applications on Linux)
  --dry-run              print the plan and stop before any download or change
  --help                 show this help`);
}

/** Map a platform/arch pair to its release asset, or null when unsupported. */
function resolveAsset(platform, arch) {
  const p = String(platform).toLowerCase();
  const a = String(arch).toLowerCase();
  if (p === "darwin" && (a === "arm64" || a === "x64" || a === "x86_64"))
    return { platform: "macos", asset: "Dani-Dex-mac-universal.dmg" };
  if (p === "linux" && (a === "x64" || a === "x86_64" || a === "amd64")) {
    return { platform: "linux", asset: "Dani-Dex-linux-x86_64.AppImage" };
  }
  if (p === "win32" || p === "windows") {
    if (a === "x64" || a === "x86_64" || a === "amd64")
      return { platform: "windows", asset: "Dani-Dex-windows-x64.exe" };
    return null;
  }
  return null;
}

function get(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const follow = (current, hops) => {
      const request = current.startsWith("http:") ? require("node:http").get : https.get;
      const req = request
        .call(null, current, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (hops >= 5) return rejectPromise(new Error("too many redirects"));
            return follow(new URL(res.headers.location, current).toString(), hops + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return rejectPromise(new Error(`GET ${current} failed with HTTP ${res.statusCode}`));
          }
          resolvePromise({ res, finalUrl: current });
        })
        .on("error", rejectPromise);
      req.setTimeout(30_000, () => req.destroy(new Error("download timed out")));
    };
    follow(url, 0);
  });
}

async function download(url, dest) {
  const { res, finalUrl } = await get(url);
  const total = Number(res.headers["content-length"] || 0);
  const out = fs.createWriteStream(dest);
  let received = 0;
  let lastTick = 0;
  res.on("data", (chunk) => {
    received += chunk.length;
    if (TTY && total > 0) {
      const now = Date.now();
      if (now - lastTick > 200) {
        lastTick = now;
        const pct = Math.floor((received / total) * 100);
        process.stdout.write(`\r${C.dim}  ${pct}% of ${(total / 1048576).toFixed(0)} MB${C.reset}   `);
      }
    }
  });
  await pipeline(res, out);
  if (TTY && total > 0) process.stdout.write(`\r${" ".repeat(30)}\r`);
  return { bytes: received, finalUrl };
}

async function fetchText(url) {
  const { res } = await get(url);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of res) {
    bytes += chunk.length;
    if (bytes > 262_144) {
      res.destroy();
      die("checksum file is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const CHECKSUM_EXTENSIONS = { macos: ".dmg", linux: ".AppImage", windows: ".exe" };

/**
 * Pick this platform's download from a sha256sum-format checksum file: the entry
 * whose file name ends with the platform's artifact extension. The checksum file is
 * the source of truth for both the file name (releases publish versioned names) and
 * its hash. Returns { name, expected } or null when no entry matches.
 */
function pickChecksumTarget(sumsText, platform) {
  const extension = CHECKSUM_EXTENSIONS[platform];
  if (!extension) return null;
  let target = null;
  for (const entry of sumsText.split("\n")) {
    const line = entry.replace(/\r$/, "").trim();
    if (!line) continue;
    if (!line.endsWith(extension)) continue;
    const match = line.match(/^([a-f\d]{64})[ \t]+\*?(Dani-Dex-[A-Za-z\d._-]+)$/i);
    if (!match || target) return null;
    const name = match[2];
    const suffix = { macos: "-universal.dmg", linux: "-x86_64.AppImage", windows: "-x64.exe" }[platform];
    if (!name.endsWith(suffix)) return null;
    target = { name, expected: match[1].toLowerCase() };
  }
  return target;
}

async function verifyChecksum(name, expected, file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  const actual = hash.digest("hex");
  if (actual !== expected) die("checksum mismatch - the download is corrupt or tampered with. Not installing it.");
  ok(`checksum verified (${name})`);
}

/** Copy before replacement; keep the installed app if copying or activation fails. */
function replaceInstalledPath(source, dest, directory) {
  const lock = `${dest}.install-lock`;
  fs.mkdirSync(lock);
  let staging;
  let previous = false;
  try {
    staging = fs.mkdtempSync(path.join(path.dirname(dest), ".dani-dex-install-"));
    const next = path.join(staging, "next");
    const backup = path.join(staging, "previous");
    if (directory) fs.cpSync(source, next, { recursive: true });
    else {
      fs.copyFileSync(source, next);
      fs.chmodSync(next, 0o755);
    }
    if (fs.existsSync(dest)) {
      fs.renameSync(dest, backup);
      previous = true;
    }
    try {
      fs.renameSync(next, dest);
    } catch (error) {
      if (previous) {
        fs.renameSync(backup, dest);
        previous = false;
      }
      throw error;
    }
    previous = false;
  } finally {
    // If restoring the old app fails, leave its recovery copy in place.
    if (staging && !previous) fs.rmSync(staging, { recursive: true, force: true });
    if (!previous) fs.rmdirSync(lock);
  }
}

function exec(file, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) return rejectPromise(new Error(`${file} ${args.join(" ")} failed: ${stderr || error.message}`));
      resolvePromise(stdout);
    });
  });
}

function defaultInstallDir(platform) {
  if (platform === "macos") {
    try {
      fs.accessSync("/Applications", fs.constants.W_OK);
      return "/Applications";
    } catch {
      return path.join(os.homedir(), "Applications");
    }
  }
  return path.join(os.homedir(), "Applications");
}

async function installMac(downloaded, installDir, noLaunch) {
  step("Installing Dani-Dex");
  fs.mkdirSync(installDir, { recursive: true });
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), "dani-dex-mount-"));
  let mounted = false;
  try {
    await exec("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, downloaded]);
    mounted = true;
    const app = fs.readdirSync(mount).find((entry) => entry.endsWith(".app"));
    if (!app) die("the disk image has no app inside - the download looks wrong.");
    const dest = path.join(installDir, "Dani-Dex.app");
    replaceInstalledPath(path.join(mount, app), dest, true);
    ok(`installed to ${dest}`);
    // Unsigned builds trip Gatekeeper on first launch; dropping quarantine matches the
    // README's manual Control-click step.
    try {
      await exec("xattr", ["-dr", "com.apple.quarantine", dest]);
    } catch {
      /* best effort */
    }
    if (!noLaunch) {
      step("Opening Dani-Dex");
      await exec("open", [dest]);
      ok("launched");
    }
  } finally {
    if (mounted) await exec("hdiutil", ["detach", mount, "-quiet"]);
    fs.rmdirSync(mount);
  }
}

async function installWindows(downloaded, noLaunch) {
  step("Running the Windows installer");
  say('  If a blue SmartScreen window appears, click "More info", then "Run anyway".');
  const child = spawn(downloaded, [], { stdio: "ignore" });
  await new Promise((resolvePromise, rejectPromise) => {
    child.on("error", () => rejectPromise(new Error(`could not start the installer. Run it by hand: ${downloaded}`)));
    child.on("exit", (code, signal) => {
      if (code !== 0) return rejectPromise(new Error(`installer failed (${signal || code})`));
      resolvePromise();
    });
  });
  const appExe = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "Programs",
    "Dani-Dex",
    "Dani-Dex.exe",
  );
  if (!noLaunch && fs.existsSync(appExe)) {
    step("Opening Dani-Dex");
    await launch(appExe);
    ok("launched");
  } else if (!noLaunch) {
    say("Open Dani-Dex from the Start Menu when you are ready.");
  }
}

async function installLinux(downloaded, installDir, noLaunch) {
  step("Installing Dani-Dex");
  fs.mkdirSync(installDir, { recursive: true });
  const dest = path.join(installDir, "Dani-Dex.AppImage");
  replaceInstalledPath(downloaded, dest, false);
  ok(`installed to ${dest}`);
  if (noLaunch) return;
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    step("Opening Dani-Dex");
    await launch(dest);
    ok("launched");
  } else {
    warn("no desktop session detected (headless or WSL without WSLg).");
    say(`  Run it when you have a desktop: ${dest}`);
  }
}

async function launch(executable) {
  const child = spawn(executable, [], { detached: true, stdio: "ignore" });
  await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("spawn", resolvePromise);
  });
  child.unref();
}

async function main() {
  const args = process.argv.slice(2);
  let noLaunch = false;
  let dryRun = false;
  let installDir = "";
  let resolveArgs = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--no-launch") noLaunch = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      usage();
      return;
    } else if (arg === "--install-dir") {
      if (!args[i + 1] || args[i + 1].startsWith("--")) die("--install-dir needs a path");
      installDir = args[i + 1];
      i += 1;
    } else if (arg === "--resolve") {
      // Hidden test hook: print the resolved asset for a platform/arch and stop.
      if (i + 2 >= args.length) die("usage: --resolve <platform> <arch>");
      resolveArgs = [args[i + 1], args[i + 2]];
      i += 2;
    } else {
      die(`unknown option: ${arg} (try --help)`);
    }
  }

  if (resolveArgs) {
    const resolved = resolveAsset(resolveArgs[0], resolveArgs[1]);
    if (!resolved)
      die(`no Dani-Dex build for ${resolveArgs[0]} ${resolveArgs[1]} - grab one by hand from ${RELEASES_PAGE}`);
    say(`platform=${resolved.platform}`);
    say(`asset=${resolved.asset}`);
    say(`url=${RELEASE_ROOT}/${resolved.asset}`);
    return;
  }

  banner();
  step("Detecting your platform");
  const resolved = resolveAsset(process.platform, process.arch);
  if (!resolved) {
    die(`no Dani-Dex build for ${process.platform} ${process.arch} yet. All downloads: ${RELEASES_PAGE}`);
  }
  const { platform, asset } = resolved;
  ok(`${process.platform} ${process.arch} - ${asset}`);

  const destDir = installDir || defaultInstallDir(platform);
  if (dryRun) {
    say();
    say(`${C.bold}Plan (dry run, nothing was downloaded or changed):${C.reset}`);
    say(`  platform:    ${platform}`);
    say(`  download:    ${RELEASE_ROOT}/${asset}`);
    say(`  checksum:    resolved from the release's SHA256SUMS-${platform}.txt at install time`);
    say(`  install to:  ${platform === "windows" ? "per-user Programs folder via the installer" : destDir}`);
    say(`  launch:      ${noLaunch ? "skipped (--no-launch)" : "open the app, onboarding starts on first run"}`);
    return;
  }

  // Both the artifact name and hash must come from the release manifest.
  let sums = "";
  try {
    sums = await fetchText(`${RELEASE_ROOT}/SHA256SUMS-${platform}.txt`);
  } catch {
    die("could not fetch release checksums. Not installing an unverifiable download.");
  }
  const target = pickChecksumTarget(sums, platform);
  if (!target) die("release checksums must contain one valid artifact for this platform. Not installing.");
  const downloadName = target.name;
  const url = `${RELEASE_ROOT}/${downloadName}`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dani-dex-onboard-"));
  try {
    step(`Downloading Dani-Dex (${downloadName})`);
    say(`${C.dim}  ${url}${C.reset}`);
    const downloaded = path.join(tmp, downloadName);
    let result;
    try {
      result = await download(url, downloaded);
    } catch (error) {
      die(`download failed - check your connection and try again. (${error.message})`);
    }
    ok(`downloaded ${(result.bytes / 1048576).toFixed(0)} MB`);

    step("Verifying the download");
    await verifyChecksum(target.name, target.expected, downloaded);

    if (platform === "macos") await installMac(downloaded, destDir, noLaunch);
    else if (platform === "windows") await installWindows(downloaded, noLaunch);
    else await installLinux(downloaded, destDir, noLaunch);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  say();
  say("Installed. Open Dani-Dex to complete setup.");
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${C.red}error${C.reset} ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { resolveAsset, pickChecksumTarget, replaceInstalledPath };
