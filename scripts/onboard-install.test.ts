import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const payload = Buffer.from("verified test artifact; never executed");
const hash = createHash("sha256").update(payload).digest("hex");
const artifact = "Dani-Dex-0.17.8-x86_64.AppImage";
const manifest = `${hash}  ${artifact}\n`;
const root = process.env.DANI_DEX_TEST_SOURCE_ROOT || resolve(import.meta.dirname, "..");

async function install(
  runner: "node" | "bash",
  sums: string | null,
  corrupt = false,
  truncated = false,
  windowsExit?: number,
) {
  const dir = mkdtempSync(join(tmpdir(), "dani-dex-install-test-"));
  const temp = join(dir, "temp");
  const applications = join(dir, "Applications");
  mkdirSync(temp);
  mkdirSync(applications);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "uname"), '#!/usr/bin/env bash\nif [ "$1" = -s ]; then echo Linux; else echo x86_64; fi\n', {
    mode: 0o755,
  });
  const preload = join(dir, "linux.cjs");
  writeFileSync(
    preload,
    windowsExit === undefined
      ? 'Object.defineProperty(process, "platform", { value: "linux" });\nObject.defineProperty(process, "arch", { value: "x64" });\n'
      : `Object.defineProperty(process, "platform", { value: "win32" });\nObject.defineProperty(process, "arch", { value: "x64" });\nconst processes = require("node:child_process");\nconst spawn = processes.spawn;\nprocesses.spawn = (file, args, options) => spawn(process.execPath, ["-e", "process.exit(${windowsExit})"], options);\n`,
  );
  const dest = join(applications, "Dani-Dex.AppImage");
  writeFileSync(dest, "previous app");
  writeFileSync(join(dir, "owner-profile"), "owner data");
  const requests: string[] = [];
  const platform = windowsExit === undefined ? "linux" : "windows";
  const filename = windowsExit === undefined ? artifact : "Dani-Dex-0.17.8-x64.exe";
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === `/SHA256SUMS-${platform}.txt` && sums !== null) response.end(sums);
    else if (request.url === `/${filename}`) {
      if (truncated) response.writeHead(200, { "Content-Length": payload.length + 100, Connection: "close" });
      response.end(corrupt ? "corrupt artifact" : payload);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    const cli = runner === "node" ? join(root, "onboard/bin/dani-dex-onboard.js") : join(root, "scripts/onboard.sh");
    const args = [cli, "--install-dir", applications, "--no-launch"];
    if (runner === "node") args.unshift("--require", preload);
    const child = spawn(runner === "node" ? process.execPath : "bash", args, {
      env: {
        ...process.env,
        TMPDIR: temp,
        TEMP: temp,
        TMP: temp,
        PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
        DANI_DEX_ONBOARD_RELEASE_ROOT: `http://127.0.0.1:${address.port}`,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const status = await new Promise<number | null>((done, fail) => {
      child.once("error", fail);
      child.once("close", done);
    });
    return {
      status,
      stdout,
      stderr,
      requests,
      installed: readFileSync(dest, "utf8"),
      profile: readFileSync(join(dir, "owner-profile"), "utf8"),
      remainingTemps: readdirSync(temp),
      remainingApps: readdirSync(applications),
    };
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    rmSync(dir, { recursive: true, force: true });
  }
}

it("reports a Windows installer subprocess failure instead of success", async () => {
  const result = await install("node", `${hash}  Dani-Dex-0.17.8-x64.exe\n`, false, false, 7);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("installer failed (7)");
  expect(result.stdout).not.toContain("Installed.");
  expect(result.remainingTemps).toEqual([]);
});

for (const runner of ["node", "bash"] as const) {
  describe(`${runner} real installer subprocess`, () => {
    it("installs the manifest's versioned artifact and preserves owner data", async () => {
      const result = await install(runner, manifest);
      expect(result.status, result.stderr).toBe(0);
      expect(result.installed).toBe(payload.toString());
      expect(result.profile).toBe("owner data");
      expect(result.requests).toEqual(["/SHA256SUMS-linux.txt", `/${artifact}`]);
      expect(result.remainingTemps).toEqual([]);
      expect(result.remainingApps).toEqual(["Dani-Dex.AppImage"]);
    });

    it.each([
      null,
      "",
      "not-a-hash  Dani-Dex-0.17.8-x86_64.AppImage\n",
      `${hash}  ../${artifact}\n`,
      `${manifest}${manifest}`,
      `${hash}  Dani-Dex-0.17.8-arm64.AppImage\n`,
    ])("blocks an absent, unsafe or ambiguous checksum manifest: %s", async (sums) => {
      const result = await install(runner, sums);
      expect(result.status).not.toBe(0);
      expect(result.installed).toBe("previous app");
      expect(result.profile).toBe("owner data");
      expect(result.requests).toEqual(["/SHA256SUMS-linux.txt"]);
      expect(result.remainingTemps).toEqual([]);
    });

    it("blocks a corrupt download and removes temporary files", async () => {
      const result = await install(runner, manifest, true);
      expect(result.status).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain("checksum mismatch");
      expect(result.installed).toBe("previous app");
      expect(result.remainingTemps).toEqual([]);
    });

    it("rejects an incomplete response and preserves the installed app", async () => {
      const result = await install(runner, manifest, false, true);
      expect(result.status).not.toBe(0);
      expect(result.installed).toBe("previous app");
      expect(result.remainingTemps).toEqual([]);
    });

    it("accepts CRLF, uppercase hex and the GNU binary marker", async () => {
      const result = await install(runner, `${hash.toUpperCase()} *${artifact}\r\n`);
      expect(result.status, result.stderr).toBe(0);
      expect(result.installed).toBe(payload.toString());
    });
  });
}
