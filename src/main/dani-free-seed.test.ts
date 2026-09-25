import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installDaniFreeEngineSeed } from "../../scripts/install-dani-free-engine-seed";
import { bundledDaniFreeEngineSeed, verifiedDaniFreeEngineSeed } from "./dani-free-seed";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bundled Dani Free engine seed", () => {
  it("pins extracted executable bytes, stages and verifies the packaged copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "engine-seed-"));
    directories.push(root);
    const bytes = Buffer.from("extracted engine executable");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const source = join(root, "engine");
    const pins = join(root, "pins.sha256");
    const resources = join(root, "resources");
    await writeFile(source, bytes);
    await writeFile(pins, `${digest}  linux-x64\n`);
    const staged = await installDaniFreeEngineSeed(source, "linux", "x64", pins, join(resources, "dani-free-engine"));
    const found = bundledDaniFreeEngineSeed(resources, "linux", "x64");
    expect(found?.executable).toBe(staged);
    if (!found) throw new Error("Expected packaged engine seed.");
    expect(await verifiedDaniFreeEngineSeed(found)).toEqual({ executable: staged, sha256: digest });
    await writeFile(staged, "changed");
    await expect(verifiedDaniFreeEngineSeed(found)).rejects.toThrow("does not match");
  });

  it("rejects missing pins and wrong digest before staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "engine-seed-"));
    directories.push(root);
    const source = join(root, "engine");
    const pins = join(root, "pins.sha256");
    await mkdir(root, { recursive: true });
    await writeFile(source, "engine");
    await writeFile(pins, "");
    await expect(installDaniFreeEngineSeed(source, "linux", "x64", pins, root)).rejects.toThrow("No pinned");
    await writeFile(pins, `${"0".repeat(64)}  linux-x64\n`);
    await expect(installDaniFreeEngineSeed(source, "linux", "x64", pins, root)).rejects.toThrow("digest mismatch");
    expect(await readFile(source, "utf8")).toBe("engine");
  });
});

describe("packaged Dani Free release validation", () => {
  it("checks both the proxy and extracted engine against separate release pins", async () => {
    const { verifyPackagedDaniFree } = await import("../../scripts/verify-packaged-dani-free");
    const { installDaniFree, daniFreeTarget } = await import("../../scripts/install-dani-free");
    const root = await mkdtemp(join(tmpdir(), "packaged-dani-free-"));
    directories.push(root);
    const resources = join(root, "resources");
    const proxy = Buffer.alloc(64);
    proxy.set([0x7f, 0x45, 0x4c, 0x46]);
    proxy.writeUInt16LE(0x3e, 18);
    const engine = Buffer.from(proxy);
    engine[24] = 1;
    const proxyDigest = createHash("sha256").update(proxy).digest("hex");
    const engineDigest = createHash("sha256").update(engine).digest("hex");
    const target = daniFreeTarget("linux", "x64");
    await writeFile(join(root, target.artifact), proxy);
    await writeFile(join(root, "source-engine"), engine);
    await writeFile(join(root, "proxy-pins"), `${proxyDigest}  ${target.artifact}\n`);
    await writeFile(join(root, "engine-pins"), `${engineDigest}  linux-x64\n`);
    await installDaniFree(root, target, join(root, "proxy-pins"), join(resources, "dani-free"));
    const stagedEngine = await installDaniFreeEngineSeed(
      join(root, "source-engine"),
      "linux",
      "x64",
      join(root, "engine-pins"),
      join(resources, "dani-free-engine"),
    );
    await expect(
      verifyPackagedDaniFree(resources, "linux", "x64", join(root, "proxy-pins"), join(root, "engine-pins")),
    ).resolves.toBeUndefined();
    await writeFile(stagedEngine, "tampered");
    await expect(
      verifyPackagedDaniFree(resources, "linux", "x64", join(root, "proxy-pins"), join(root, "engine-pins")),
    ).rejects.toThrow("does not match");
  });
});
