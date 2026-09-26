import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadDaniFreeProxy } from "./download-dani-free-proxy";
import { DANI_FREE_TARGETS } from "./install-dani-free";

const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const bytes = Object.fromEntries(
  DANI_FREE_TARGETS.map((target) => {
    const buffer = Buffer.alloc(128);
    if (target.platform === "darwin") {
      buffer.writeUInt32LE(0xfeedfacf, 0);
      buffer.writeUInt32LE(target.arch === "arm64" ? 0x0100000c : 0x01000007, 4);
    } else if (target.platform === "linux") {
      buffer.set([0x7f, 0x45, 0x4c, 0x46]);
      buffer.writeUInt16LE(target.arch === "arm64" ? 0xb7 : 0x3e, 18);
    } else {
      buffer.write("MZ", 0, "ascii");
      buffer.writeUInt32LE(64, 0x3c);
      buffer.write("PE\0\0", 64, "ascii");
      buffer.writeUInt16LE(0x8664, 68);
    }
    return [target.artifact, buffer];
  }),
);
const pins = new Map(DANI_FREE_TARGETS.map((target) => [target.artifact, digest(bytes[target.artifact])]));
const sum = DANI_FREE_TARGETS.map((target) => `${pins.get(target.artifact)}  ${target.artifact}`).join("\n");
const archive = zipSync({ ...bytes, SHA256SUMS: new TextEncoder().encode(`${sum}\n`) });
const lock = {
  repository: "somdipto/Dani-Free-proxy" as const,
  commit: "a".repeat(40),
  runId: 4,
  artifactId: 5,
  artifactName: "dani-free-binaries" as const,
  zipSha256: digest(archive),
};
const base = "https://api.github.com/repos/somdipto/Dani-Free-proxy/actions";
const run = { id: 4, head_sha: lock.commit, status: "completed", conclusion: "success" };
const artifact = {
  id: 5,
  name: lock.artifactName,
  digest: `sha256:${lock.zipSha256}`,
  expired: false,
  workflow_run: { id: 4, head_sha: lock.commit },
};
function mockFetch(runData: typeof run = run, artifactData: typeof artifact = artifact, data: Uint8Array = archive) {
  const fetchImpl: typeof fetch = vi.fn(async (input) => {
    const url = String(input);
    if (url === `${base}/runs/4`) return new Response(JSON.stringify(runData));
    if (url === `${base}/artifacts/5`) return new Response(JSON.stringify(artifactData));
    if (url === `${base}/artifacts/5/zip`) return new Response(new Uint8Array(data).buffer);
    throw new Error(`Unexpected test URL: ${url}`);
  });
  return fetchImpl;
}
const created: string[] = [];
afterEach(async () => {
  for (const path of created.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("Dani Free proxy artifact provenance", () => {
  it("copies only validated binaries from a matching successful run and digest", async () => {
    const output = await mkdtemp(join(tmpdir(), "free-proxy-test-"));
    created.push(output);
    await downloadDaniFreeProxy({ token: "test-token", lock, pinned: pins, fetchImpl: mockFetch(), output });
    expect((await readdir(output)).sort()).toEqual(DANI_FREE_TARGETS.map((target) => target.artifact).sort());
    for (const target of DANI_FREE_TARGETS)
      expect(new Uint8Array(await readFile(join(output, target.artifact)))).toEqual(
        new Uint8Array(bytes[target.artifact]),
      );
  });

  it.each([
    ["failed run", { ...run, conclusion: "failure" }, artifact, archive],
    ["different commit", { ...run, head_sha: "b".repeat(40) }, artifact, archive],
    ["expired artifact", run, { ...artifact, expired: true }, archive],
    ["changed artifact ID", run, { ...artifact, id: 6 }, archive],
    ["changed ZIP", run, artifact, new Uint8Array([7, 8])],
  ])("refuses %s without writing files", async (_label, runData, artifactData, data) => {
    const output = await mkdtemp(join(tmpdir(), "free-proxy-test-"));
    created.push(output);
    await expect(
      downloadDaniFreeProxy({
        token: "test-token",
        lock,
        pinned: pins,
        fetchImpl: mockFetch(runData, artifactData, data),
        output,
      }),
    ).rejects.toThrow();
    expect(await readdir(output)).toEqual([]);
  });

  it("rejects a mismatched pinned executable before writing files", async () => {
    const output = await mkdtemp(join(tmpdir(), "free-proxy-test-"));
    created.push(output);
    const wrong = new Map(pins);
    wrong.set(DANI_FREE_TARGETS[0].artifact, "c".repeat(64));
    await expect(
      downloadDaniFreeProxy({ token: "test-token", lock, pinned: wrong, fetchImpl: mockFetch(), output }),
    ).rejects.toThrow(/pinned SHA-256/);
    expect(await readdir(output)).toEqual([]);
  });
});
