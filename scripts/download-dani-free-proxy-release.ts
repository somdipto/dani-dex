import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { DANI_FREE_TARGETS, parseSha256Sums, verifyDaniFreeBinary } from "./install-dani-free";

const RELEASE_ROOT = "https://github.com/somdipto/Dani-Free-proxy/releases/download/";
const sha = z.string().regex(/^[0-9a-f]{64}$/u);
const lockSchema = z.object({
  repository: z.literal("somdipto/Dani-Free-proxy"),
  tag: z.string().regex(/^v\d+\.\d+\.\d+-dani-dex\.\d+$/u),
  commit: z.string().regex(/^[0-9a-f]{40}$/u),
  manifestSha256: sha,
});
type ReleaseLock = z.infer<typeof lockSchema>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A release is public and durable, but no byte is trusted without the exact checked-in pins. */
export async function downloadDaniFreeProxyRelease(options: {
  lock: ReleaseLock;
  pinned: Map<string, string>;
  fetchImpl?: typeof fetch;
  output?: string;
}): Promise<string> {
  const lock = lockSchema.parse(options.lock);
  const { pinned } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiHeaders = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Dani-Dex-CI-proxy-release",
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
  const release = await fetchImpl(`https://api.github.com/repos/${lock.repository}/releases/tags/${lock.tag}`, {
    headers: apiHeaders,
  });
  if (!release.ok) throw new Error(`Pinned Dani Free release metadata returned HTTP ${release.status}.`);
  const metadata = z
    .object({
      tag_name: z.string(),
      draft: z.boolean(),
      assets: z.array(z.object({ name: z.string(), digest: z.string() })),
    })
    .parse(await release.json());
  if (metadata.tag_name !== lock.tag || metadata.draft) throw new Error("Pinned Dani Free release is not published.");
  const tag = await fetchImpl(`https://api.github.com/repos/${lock.repository}/git/ref/tags/${lock.tag}`, {
    headers: apiHeaders,
  });
  if (!tag.ok) throw new Error(`Pinned Dani Free release ref returned HTTP ${tag.status}.`);
  const ref = z
    .object({ object: z.object({ type: z.enum(["commit", "tag"]), sha: z.string() }) })
    .parse(await tag.json());
  let commit = ref.object.sha;
  if (ref.object.type === "tag") {
    const annotated = await fetchImpl(`https://api.github.com/repos/${lock.repository}/git/tags/${commit}`, {
      headers: apiHeaders,
    });
    if (!annotated.ok) throw new Error(`Pinned Dani Free annotated tag returned HTTP ${annotated.status}.`);
    const object = z
      .object({ object: z.object({ type: z.literal("commit"), sha: z.string() }) })
      .parse(await annotated.json());
    commit = object.object.sha;
  }
  if (commit !== lock.commit) throw new Error("Pinned Dani Free release tag commit changed.");
  const expectedNames = ["SHA256SUMS", ...DANI_FREE_TARGETS.map((target) => target.artifact)];
  if (
    metadata.assets.length !== expectedNames.length ||
    expectedNames.some((name) => metadata.assets.filter((asset) => asset.name === name).length !== 1)
  ) {
    throw new Error("Pinned Dani Free release file set changed.");
  }
  const manifestAsset = metadata.assets.find((asset) => asset.name === "SHA256SUMS");
  if (manifestAsset?.digest !== `sha256:${lock.manifestSha256}`)
    throw new Error("Dani Free release manifest digest changed.");
  const root = `${RELEASE_ROOT}${lock.tag}`;
  const manifestResponse = await fetchImpl(`${root}/SHA256SUMS`);
  if (!manifestResponse.ok) throw new Error(`Dani Free release manifest returned HTTP ${manifestResponse.status}.`);
  const manifestBytes = new Uint8Array(await manifestResponse.arrayBuffer());
  if (sha256(manifestBytes) !== lock.manifestSha256) throw new Error("Dani Free release manifest bytes changed.");
  const manifest = parseSha256Sums(Buffer.from(manifestBytes).toString("utf8"));
  if (manifest.size !== DANI_FREE_TARGETS.length || pinned.size !== DANI_FREE_TARGETS.length) {
    throw new Error("Dani Free release pins or manifest have an unexpected target.");
  }
  const validated: { name: string; bytes: Uint8Array }[] = [];
  for (const target of DANI_FREE_TARGETS) {
    const expected = pinned.get(target.artifact);
    if (!expected || manifest.get(target.artifact) !== expected)
      throw new Error(`Dani Free release manifest disagrees for ${target.artifact}.`);
    if (metadata.assets.find((asset) => asset.name === target.artifact)?.digest !== `sha256:${expected}`) {
      throw new Error(`Dani Free release asset metadata disagrees for ${target.artifact}.`);
    }
    const response = await fetchImpl(`${root}/${target.artifact}`);
    if (!response.ok) throw new Error(`Dani Free release ${target.artifact} returned HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verifyDaniFreeBinary(bytes, target, pinned);
    if (target.platform === "darwin") {
      const machine = target.arch === "arm64" ? 0x0100000c : 0x01000007;
      if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== machine)
        throw new Error(`Dani Free release is not ${target.arch} Mach-O.`);
    } else if (target.platform === "linux") {
      if (
        bytes.length < 20 ||
        bytes.toString("binary", 0, 4) !== "\x7fELF" ||
        bytes.readUInt16LE(18) !== (target.arch === "x64" ? 0x3e : 0xb7)
      )
        throw new Error(`Dani Free release is not ${target.arch} ELF.`);
    } else {
      if (bytes.length < 0x40 || bytes.toString("ascii", 0, 2) !== "MZ")
        throw new Error("Dani Free release is not PE.");
      const offset = bytes.readUInt32LE(0x3c);
      if (
        bytes.length < offset + 6 ||
        bytes.toString("ascii", offset, offset + 4) !== "PE\0\0" ||
        bytes.readUInt16LE(offset + 4) !== 0x8664
      )
        throw new Error("Dani Free release is not Windows x64 PE.");
    }
    validated.push({ name: target.artifact, bytes });
  }
  const output = options.output ?? (await mkdtemp(join(tmpdir(), "dani-free-proxy-release-")));
  try {
    for (const entry of validated) await writeFile(join(output, entry.name), entry.bytes);
  } catch (error) {
    if (!options.output) await rm(output, { recursive: true, force: true });
    throw error;
  }
  return output;
}

if (import.meta.main) {
  const lock = lockSchema.parse(JSON.parse(await readFile(resolve("scripts/dani-free-proxy-release.json"), "utf8")));
  const pinned = parseSha256Sums(await readFile(resolve("scripts/dani-free-binaries.sha256"), "utf8"));
  const directory = await downloadDaniFreeProxyRelease({ lock, pinned });
  if (process.env.GITHUB_ENV)
    await writeFile(process.env.GITHUB_ENV, `DANI_FREE_BINARIES_DIR=${directory}\n`, { flag: "a" });
  else process.stdout.write(`${directory}\n`);
}
