import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundledDaniFreeExecutable, DaniFreeSupervisor, parseDaniFreeReadyLine } from "./dani-free";

const directories: string[] = [];
const supervisors: DaniFreeSupervisor[] = [];
afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.stop()));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * A stand-in for `dani-free start` that keeps its contract: it listens on 127.0.0.1, writes a 600
 * key file, prints the ready line, checks the key on every request and logs what it was asked.
 */
async function fakeDaniFree(
  options: { failBeforeReady?: boolean; leaveChild?: boolean } = {},
): Promise<{ executable: string; log: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "dani-free-"));
  directories.push(root);
  const log = join(root, "requests.log");
  const executable = join(root, "dani-free");
  await writeFile(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const root = ${JSON.stringify(root)};
if (${options.failBeforeReady === true}) { process.stderr.write("port in use\\n"); process.exit(3); }
fs.appendFileSync(${JSON.stringify(log)}, "argv " + process.argv.slice(2).join(" ") + " private=" + (process.env.DANI_FREE_PRIVATE_MODE || "") + "\\n");
if (${options.leaveChild === true}) {
  // Like the OpenCode the real proxy runs: a child in its group that it does not stop on the way out.
  const child = require("node:child_process").spawn("sleep", ["120"], { stdio: "ignore" });
  fs.writeFileSync(path.join(root, "child.pid"), String(child.pid));
}
const keyFile = path.join(root, "key");
fs.writeFileSync(keyFile, "install-key\\n", { mode: 0o600 });
const server = http.createServer((req, res) => {
  fs.appendFileSync(${JSON.stringify(log)}, req.method + " " + req.url + " " + req.headers["x-api-key"] + "\\n");
  if (req.headers["x-api-key"] !== "install-key") { res.writeHead(401); return res.end(); }
  if (req.url === "/v1/models/refresh") { res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: [{ id: "kilo/some-upstream-model" }, { id: "dani-free-auto", name: "Dani Free Auto" }] }));
  }
  res.writeHead(404); res.end();
});
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  process.stdout.write("starting\\n");
  process.stdout.write("DANI_FREE_READY " + JSON.stringify({ baseUrl: "http://127.0.0.1:" + port, port, pid: process.pid, apiKeyFile: keyFile, privateMode: process.env.DANI_FREE_PRIVATE_MODE === "1" }) + "\\n");
});
process.on("SIGTERM", () => { fs.appendFileSync(${JSON.stringify(log)}, "SIGTERM\\n"); process.exit(0); });
`,
  );
  await chmod(executable, 0o755);
  return { executable, log, root };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")("Dani-Free leftovers", () => {
  it("stops what the proxy started when the app stops it", async () => {
    const fake = await fakeDaniFree({ leaveChild: true });
    const supervisor = new DaniFreeSupervisor({ executable: fake.executable, home: join(fake.root, "home") });
    supervisors.push(supervisor);
    expect(await supervisor.start()).not.toBeNull();
    const child = Number(await readFile(join(fake.root, "child.pid"), "utf8"));
    expect(alive(child)).toBe(true);
    await supervisor.stop();
    await expect.poll(() => alive(child), { timeout: 3_000 }).toBe(false);
  });

  it("ends a group a force-killed run left behind before starting again", async () => {
    const fake = await fakeDaniFree({ leaveChild: true });
    const home = join(fake.root, "home");
    const first = new DaniFreeSupervisor({ executable: fake.executable, home });
    expect(await first.start()).not.toBeNull();
    const child = Number(await readFile(join(fake.root, "child.pid"), "utf8"));
    // A force-kill: the proxy dies without a word and nothing tells the supervisor.
    const group = Number((await readFile(join(home, "dani-dex-process-group"), "utf8")).trim());
    process.kill(group, "SIGKILL");
    await expect.poll(() => alive(group), { timeout: 3_000 }).toBe(false);
    expect(alive(child)).toBe(true);

    const next = new DaniFreeSupervisor({ executable: fake.executable, home });
    supervisors.push(next);
    await next.sweepLeftovers();
    await expect.poll(() => alive(child), { timeout: 3_000 }).toBe(false);
  });
});

describe("parseDaniFreeReadyLine", () => {
  it("reads the ready line", () => {
    expect(
      parseDaniFreeReadyLine(
        'DANI_FREE_READY {"baseUrl":"http://127.0.0.1:4410/","port":4410,"pid":7,"apiKeyFile":"/k","privateMode":true}',
      ),
    ).toEqual({ baseUrl: "http://127.0.0.1:4410", port: 4410, pid: 7, apiKeyFile: "/k", privateMode: true });
  });

  it("keeps the origin when the proxy reports its OpenAI base", () => {
    expect(
      parseDaniFreeReadyLine(
        'DANI_FREE_READY {"baseUrl":"http://127.0.0.1:46433/v1","port":46433,"pid":42057,"apiKeyFile":"/tmp/dfh/api-key","privateMode":false}',
      )?.baseUrl,
    ).toBe("http://127.0.0.1:46433");
  });

  it.each([
    "starting",
    "DANI_FREE_READY not json",
    'DANI_FREE_READY {"baseUrl":"https://example.com","port":1,"pid":1,"apiKeyFile":"/k"}',
    'DANI_FREE_READY {"baseUrl":"http://127.0.0.1:1","port":1,"pid":1}',
  ])("ignores anything else: %s", (line) => {
    expect(parseDaniFreeReadyLine(line)).toBeNull();
  });
});

describe("DaniFreeSupervisor", () => {
  it("starts the proxy, lists its models without forcing a refresh, and names the source Dani", async () => {
    const fake = await fakeDaniFree();
    const supervisor = new DaniFreeSupervisor({ executable: fake.executable, home: join(tmpdir(), "unused") });
    supervisors.push(supervisor);
    const source = await supervisor.start();
    expect(source).toMatchObject({
      id: "dani",
      name: "Dani",
      models: [{ id: "dani-free-auto", name: "Dani Free Auto" }],
      headers: [{ name: "x-api-key", value: "install-key" }],
      apiKey: "install-key",
    });
    expect(source?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    // No upstream model name leaves the proxy.
    expect(JSON.stringify(source)).not.toContain("kilo");
    const requests = await readFile(fake.log, "utf8");
    expect(requests).toContain("argv start private=0\n");
    expect(requests).toContain("GET /v1/models install-key");
    expect(requests).not.toContain("/v1/models/refresh");

    await supervisor.stop();
    expect(await readFile(fake.log, "utf8")).toContain("SIGTERM");
  });

  it("turns on private mode through the environment", async () => {
    const fake = await fakeDaniFree();
    const supervisor = new DaniFreeSupervisor({
      executable: fake.executable,
      home: join(tmpdir(), "unused"),
      privateMode: true,
    });
    supervisors.push(supervisor);
    await supervisor.start();
    expect(await readFile(fake.log, "utf8")).toContain("argv start private=1\n");
  });

  it("resolves null when the proxy exits before it is ready", async () => {
    const fake = await fakeDaniFree({ failBeforeReady: true });
    const supervisor = new DaniFreeSupervisor({ executable: fake.executable, home: join(tmpdir(), "unused") });
    supervisors.push(supervisor);
    await expect(supervisor.start()).resolves.toBeNull();
  });

  it("resolves null when no ready line arrives in time", async () => {
    const root = await mkdtemp(join(tmpdir(), "dani-free-"));
    directories.push(root);
    const executable = join(root, "dani-free");
    await writeFile(executable, "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n");
    await chmod(executable, 0o755);
    const supervisor = new DaniFreeSupervisor({ executable, home: join(tmpdir(), "unused"), readyTimeoutMs: 300 });
    supervisors.push(supervisor);
    await expect(supervisor.start()).resolves.toBeNull();
  });
});

describe("bundledDaniFreeExecutable", () => {
  it("finds the binary for this platform and architecture only", async () => {
    const root = await mkdtemp(join(tmpdir(), "resources-"));
    directories.push(root);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "dani-free", "darwin", "x64"), { recursive: true });
    await writeFile(join(root, "dani-free", "darwin", "x64", "dani-free"), "");
    expect(bundledDaniFreeExecutable(root, "darwin", "x64")).toBe(
      join(root, "dani-free", "darwin", "x64", "dani-free"),
    );
    expect(bundledDaniFreeExecutable(root, "darwin", "arm64")).toBeNull();
    expect(bundledDaniFreeExecutable(root, "win32", "x64")).toBeNull();
  });
});

const realBinary = process.env.DANI_DEX_DANI_FREE_TEST_PATH?.trim();

describe.skipIf(!realBinary)("DaniFreeSupervisor with the real proxy", () => {
  it("starts it under Dani-Dex's folder, reads its key and lists only Dani", async () => {
    const home = await mkdtemp(join(tmpdir(), "dani-free-home-"));
    directories.push(home);
    const supervisor = new DaniFreeSupervisor({ executable: realBinary ?? "", home });
    supervisors.push(supervisor);
    const source = await supervisor.start();
    expect(source).toMatchObject({
      id: "dani",
      name: "Dani",
      models: [{ id: "dani-free-auto", name: "Dani Free Auto" }],
    });
    expect(source?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const response = await fetch(`${source?.baseUrl}/models`, {
      headers: { authorization: `Bearer ${source?.apiKey}` },
    });
    expect(response.status).toBe(200);
    expect((await fetch(`${source?.baseUrl}/models`)).status).toBe(401);
    await supervisor.stop();
    await expect(fetch(`${source?.baseUrl}/models`)).rejects.toThrow();
  }, 60_000);
});
