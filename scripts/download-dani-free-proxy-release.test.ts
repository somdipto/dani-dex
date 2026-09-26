import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadDaniFreeProxyRelease } from "./download-dani-free-proxy-release";
import { DANI_FREE_TARGETS } from "./install-dani-free";

const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const bytes = new Map(
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
    return [target.artifact, buffer] as const;
  }),
);
const pinned = new Map(Array.from(bytes, ([name, value]) => [name, digest(value)]));
const manifest = Buffer.from(`${Array.from(pinned, ([name, hash]) => `${hash}  ${name}`).join("\n")}\n`);
const lock = {
  repository: "somdipto/Dani-Free-proxy" as const,
  tag: "v0.1.0-dani-dex.1",
  commit: "a".repeat(40),
  manifestSha256: digest(manifest),
};
const releaseRoot = `https://github.com/${lock.repository}/releases/download/${lock.tag}`;
const apiRoot = `https://api.github.com/repos/${lock.repository}`;
const release = {
  tag_name: lock.tag,
  draft: false,
  assets: [
    { name: "SHA256SUMS", digest: `sha256:${lock.manifestSha256}` },
    ...Array.from(pinned, ([name, hash]) => ({ name, digest: `sha256:${hash}` })),
  ],
};
function mockFetch(
  overrides: { commit?: string; release?: typeof release; broken?: string; manifest?: Buffer } = {},
): typeof fetch {
  return vi.fn(async (input) => {
    const url = String(input);
    if (url === `${apiRoot}/releases/tags/${lock.tag}`) return Response.json(overrides.release ?? release);
    if (url === `${apiRoot}/git/ref/tags/${lock.tag}`)
      return Response.json({ object: { type: "commit", sha: overrides.commit ?? lock.commit } });
    if (url === `${releaseRoot}/SHA256SUMS`) return new Response(new Uint8Array(overrides.manifest ?? manifest));
    for (const [name, value] of bytes)
      if (url === `${releaseRoot}/${name}`)
        return new Response(new Uint8Array(name === overrides.broken ? Buffer.from("tampered") : value));
    throw new Error(`Unexpected URL: ${url}`);
  });
}
const created: string[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Dani Free public release provenance", () => {
  it("copies all and only digest-pinned release executables", async () => {
    const output = await mkdtemp(join(tmpdir(), "free-proxy-release-test-"));
    created.push(output);
    await downloadDaniFreeProxyRelease({ lock, pinned, fetchImpl: mockFetch(), output });
    expect((await readdir(output)).sort()).toEqual(Array.from(bytes.keys()).sort());
    for (const [name, expected] of bytes) expect(await readFile(join(output, name))).toEqual(expected);
  });
  it.each([
    ["changed commit", { commit: "b".repeat(40) }],
    ["changed manifest", { manifest: Buffer.from("changed") }],
    ["changed binary", { broken: DANI_FREE_TARGETS[0].artifact }],
    [
      "extra asset",
      { release: { ...release, assets: [...release.assets, { name: "surprise", digest: "sha256:123" }] } },
    ],
  ])("refuses %s before writing", async (_reason, changed) => {
    const output = await mkdtemp(join(tmpdir(), "free-proxy-release-test-"));
    created.push(output);
    await expect(
      downloadDaniFreeProxyRelease({ lock, pinned, fetchImpl: mockFetch(changed), output }),
    ).rejects.toThrow();
    expect(await readdir(output)).toEqual([]);
  });
});
