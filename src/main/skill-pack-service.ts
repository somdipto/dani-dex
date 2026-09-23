import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { classifyAgentRole } from "@dani-dex/contracts/agent-harness-routing";
import type { AgentSummary } from "@dani-dex/contracts/ipc";
import { type SkillPack, skillPacksForRole } from "@dani-dex/contracts/skill-packs";
import { createDaniDexLogger, toLogValue } from "@dani-dex/logging";
import { type ManagedSkillFile, seedWorkspaceFiles, syncManagedSkillFiles } from "./managed-skill-service";

const logger = createDaniDexLogger("skill-pack-service");

type SkillPackAgent = Pick<AgentSummary, "name" | "title" | "description" | "workspacePath">;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ResolvedPack {
  skills: { slug: string; files: ManagedSkillFile[] }[];
  workspace: ManagedSkillFile[];
}

export interface SkillPackServiceOptions {
  /** Where bundled packs live: `resources/skill-packs` in a checkout, `Resources/skill-packs` packaged. */
  bundledRoot: string;
  /** Where downloaded packs are kept, under the app's data directory. */
  cacheRoot: string;
  fetch?: Fetcher;
  packs?: (kind: "technical" | "general") => SkillPack[];
}

/**
 * Gives each bot the skill packs for what it was created as.
 *
 * A bot is classified once from its name, title and purpose - the same rule the harness router
 * uses - and receives the packs for that role in its workspace, next to the base Dani-Dex skills.
 * Bundled packs are read from the app. A downloaded pack is fetched the first time a bot needs it,
 * checked against the hash pinned in the manifest, and kept in the data directory, so later bots
 * and later launches work offline. A pack that fails to arrive is logged and skipped; a bot is never
 * held back from starting by a skill.
 */
export class SkillPackService {
  readonly #options: Required<SkillPackServiceOptions>;
  readonly #resolved = new Map<string, Promise<ResolvedPack>>();

  constructor(options: SkillPackServiceOptions) {
    this.#options = { fetch, packs: skillPacksForRole, ...options };
  }

  packsFor(agent: Pick<AgentSummary, "name" | "title" | "description">): SkillPack[] {
    return this.#options.packs(classifyAgentRole(agent).kind);
  }

  async syncAll(agents: readonly SkillPackAgent[]): Promise<void> {
    for (const agent of agents) await this.syncAgent(agent);
  }

  async syncAgent(agent: SkillPackAgent): Promise<void> {
    for (const pack of this.packsFor(agent)) {
      try {
        const resolved = await this.#resolve(pack);
        for (const skill of resolved.skills) {
          const result = await syncManagedSkillFiles(agent.workspacePath, skill.slug, skill.files);
          for (const target of result.collisions) {
            logger.warn(`Kept the user's own skill at ${target}; the ${pack.id} pack did not replace it.`);
          }
          for (const failure of result.failures) {
            logger.error(`Could not install ${skill.slug} at ${failure.target}.`, toLogValue(failure.error));
          }
        }
        if (resolved.workspace.length > 0) await seedWorkspaceFiles(agent.workspacePath, resolved.workspace);
      } catch (error) {
        logger.error(`Could not give ${agent.name} the ${pack.id} skill pack.`, toLogValue(error));
      }
    }
  }

  #resolve(pack: SkillPack): Promise<ResolvedPack> {
    let pending = this.#resolved.get(pack.id);
    if (!pending) {
      pending = pack.source.kind === "bundled" ? this.#readBundled(pack.source.directory) : this.#download(pack);
      // A failed download is retried by the next bot rather than remembered.
      pending.catch(() => this.#resolved.delete(pack.id));
      this.#resolved.set(pack.id, pending);
    }
    return pending;
  }

  async #readBundled(directory: string): Promise<ResolvedPack> {
    const root = join(this.#options.bundledRoot, directory);
    const skills: ResolvedPack["skills"] = [];
    for (const entry of await readdir(join(root, "skills"), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      skills.push({ slug: entry.name, files: await readTree(join(root, "skills", entry.name)) });
    }
    const workspace = await readTree(join(root, "workspace")).catch((error) => {
      if (isMissing(error)) return [];
      throw error;
    });
    return { skills, workspace };
  }

  async #download(pack: SkillPack): Promise<ResolvedPack> {
    if (pack.source.kind !== "github") throw new Error(`${pack.id} is not a downloaded pack.`);
    const { repository, commit, files } = pack.source;
    const skills: ResolvedPack["skills"] = [];
    for (const file of files) {
      const cachePath = join(this.#options.cacheRoot, pack.id, commit, file.slug, "SKILL.md");
      let content = await readFile(cachePath, "utf8").catch(() => null);
      if (content === null || sha256(content) !== file.sha256) {
        const response = await this.#options.fetch(
          `https://raw.githubusercontent.com/${repository}/${commit}/${file.path}`,
          { signal: AbortSignal.timeout(20_000) },
        );
        if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${repository}/${file.path}.`);
        content = await response.text();
        if (sha256(content) !== file.sha256) {
          throw new Error(`${repository}/${file.path} at ${commit} does not match its pinned hash.`);
        }
        await mkdir(dirname(cachePath), { recursive: true });
        const temporary = `${cachePath}.${process.pid}.tmp`;
        await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, cachePath);
      }
      skills.push({ slug: file.slug, files: [{ path: "SKILL.md", content }] });
    }
    return { skills, workspace: [] };
  }
}

async function readTree(root: string): Promise<ManagedSkillFile[]> {
  const files: ManagedSkillFile[] = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.push({
      path: relative(root, path).split(sep).join("/"),
      content: await readFile(path, "utf8"),
      executable: entry.name.endsWith(".sh"),
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
