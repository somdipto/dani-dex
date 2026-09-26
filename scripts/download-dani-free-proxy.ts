import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { z } from "zod";
import { DANI_FREE_TARGETS, parseSha256Sums, verifyDaniFreeBinary } from "./install-dani-free";

const sha = z.string().regex(/^[0-9a-f]{64}$/u);
const lockSchema = z.object({
  repository: z.literal("somdipto/Dani-Free-proxy"),
  commit: z.string().regex(/^[0-9a-f]{40}$/u),
  runId: z.number().int().positive(),
  artifactId: z.number().int().positive(),
  artifactName: z.literal("dani-free-binaries"),
  zipSha256: sha,
});
type ProxyLock = z.infer<typeof lockSchema>;

type Fetch = typeof fetch;
const headers = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "User-Agent": "Dani-Dex-CI-proxy-artifact",
});

async function apiJson<T extends z.ZodType>(
  fetchImpl: Fetch,
  url: string,
  token: string,
  schema: T,
): Promise<z.infer<T>> {
  const response = await fetchImpl(url, { headers: headers(token), redirect: "error" });
  if (!response.ok) throw new Error(`Proxy artifact metadata returned HTTP ${response.status}.`);
  return schema.parse(await response.json());
}

/** CI fetches only this exact successful run and artifact. Requires a credential with cross-repo artifact read access. */
export async function downloadDaniFreeProxy(options: {
  token: string;
  lock: ProxyLock;
  pinned: Map<string, string>;
  fetchImpl?: Fetch;
  output?: string;
}): Promise<string> {
  const { token, lock, pinned } = options;
  if (!token) throw new Error("A scoped Dani Free artifact read token is required.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `https://api.github.com/repos/${lock.repository}/actions`;
  const run = await apiJson(
    fetchImpl,
    `${base}/runs/${lock.runId}`,
    token,
    z.object({ id: z.number(), head_sha: z.string(), status: z.string(), conclusion: z.string() }),
  );
  if (
    run.id !== lock.runId ||
    run.head_sha !== lock.commit ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  ) {
    throw new Error("Pinned Dani Free CI run is not the successful source commit.");
  }
  const artifact = await apiJson(
    fetchImpl,
    `${base}/artifacts/${lock.artifactId}`,
    token,
    z.object({
      id: z.number(),
      name: z.string(),
      digest: z.string(),
      expired: z.boolean(),
      workflow_run: z.object({ id: z.number(), head_sha: z.string() }),
    }),
  );
  if (
    artifact.id !== lock.artifactId ||
    artifact.name !== lock.artifactName ||
    artifact.digest !== `sha256:${lock.zipSha256}` ||
    artifact.expired ||
    artifact.workflow_run.id !== lock.runId ||
    artifact.workflow_run.head_sha !== lock.commit
  ) {
    throw new Error("Pinned Dani Free artifact provenance or digest changed.");
  }
  // Only GitHub's artifact archive endpoint may redirect to a short-lived signed object URL.
  const response = await fetchImpl(`${base}/artifacts/${lock.artifactId}/zip`, { headers: headers(token) });
  if (!response.ok) throw new Error(`Pinned Dani Free artifact download returned HTTP ${response.status}.`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(archive).digest("hex") !== lock.zipSha256) {
    throw new Error("Pinned Dani Free artifact ZIP has an unexpected SHA-256.");
  }
  const entries = unzipSync(archive);
  const names = Object.keys(entries).sort();
  const expected = ["SHA256SUMS", ...DANI_FREE_TARGETS.map((target) => target.artifact)].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error("Proxy artifact ZIP file set changed.");
  const manifest = parseSha256Sums(Buffer.from(entries.SHA256SUMS).toString("utf8"));
  for (const target of DANI_FREE_TARGETS) {
    const bytes = Buffer.from(entries[target.artifact]);
    verifyDaniFreeBinary(bytes, target, pinned);
    if (target.platform === "darwin") {
      const machine = target.arch === "arm64" ? 0x0100000c : 0x01000007;
      if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== machine)
        throw new Error(`Proxy artifact is not a ${target.arch} Mach-O executable.`);
    } else if (target.platform === "linux") {
      if (
        bytes.length < 20 ||
        bytes.toString("binary", 0, 4) !== "\x7fELF" ||
        bytes.readUInt16LE(18) !== (target.arch === "x64" ? 0x3e : 0xb7)
      )
        throw new Error(`Proxy artifact is not a ${target.arch} ELF executable.`);
    } else {
      if (bytes.length < 0x40 || bytes.toString("ascii", 0, 2) !== "MZ")
        throw new Error("Proxy artifact is not a PE executable.");
      const offset = bytes.readUInt32LE(0x3c);
      if (
        bytes.length < offset + 6 ||
        bytes.toString("ascii", offset, offset + 4) !== "PE\0\0" ||
        bytes.readUInt16LE(offset + 4) !== 0x8664
      )
        throw new Error("Proxy artifact is not a Windows x64 executable.");
    }
    if (manifest.get(target.artifact) !== pinned.get(target.artifact)) {
      throw new Error(`CI SHA256SUMS disagrees with the pinned ${target.artifact}.`);
    }
  }
  if (manifest.size !== DANI_FREE_TARGETS.length) throw new Error("CI SHA256SUMS contains an unexpected target.");
  const output = options.output ?? (await mkdtemp(join(tmpdir(), "dani-free-proxy-")));
  try {
    for (const target of DANI_FREE_TARGETS) await writeFile(join(output, target.artifact), entries[target.artifact]);
  } catch (error) {
    if (!options.output) await rm(output, { recursive: true, force: true });
    throw error;
  }
  return output;
}

if (import.meta.main) {
  const token = process.env.DANI_FREE_ARTIFACT_TOKEN;
  if (!token) throw new Error("DANI_FREE_ARTIFACT_TOKEN is required (cross-repository Actions artifact read grant).");
  const lock = lockSchema.parse(JSON.parse(await readFile(resolve("scripts/dani-free-proxy-artifact.json"), "utf8")));
  const pinned = parseSha256Sums(await readFile(resolve("scripts/dani-free-binaries.sha256"), "utf8"));
  const directory = await downloadDaniFreeProxy({ token, lock, pinned });
  // Do not log the token, redirect URL, or binary content. GitHub Actions stores the location for later steps.
  if (process.env.GITHUB_ENV)
    await writeFile(process.env.GITHUB_ENV, `DANI_FREE_BINARIES_DIR=${directory}\n`, { flag: "a" });
  else process.stdout.write(`${directory}\n`);
}
