import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentSummary, InstalledSkill } from "@dani-dex/contracts/ipc";
import { isDynamicRecord } from "@dani-dex/contracts/runtime-values";
import { createDaniDexLogger, toLogValue } from "@dani-dex/logging";
import { parse as parseYaml } from "yaml";

const MANAGED_SKILL_SLUG = "dani-dex-site-hosting";
const OWNERSHIP_MARKER = ".dani-dex-managed.json";

const logger = createDaniDexLogger("managed-skill-service");

export interface SyncTargetsResult {
  collisions: string[];
  failures: { target: string; error: unknown }[];
}

export class ManagedSkillService {
  #content: string | null = null;

  constructor(
    private readonly sourcePath: string,
    private readonly reportCollision: (target: string) => void = (target) => {
      logger.warn(`Dani-Dex preserved an unowned managed-skill collision at ${target}.`);
    },
    private readonly reportFailure: (target: string, error: unknown) => void = (target, error) => {
      logger.error(`Dani-Dex could not synchronize the managed skill at ${target}.`, toLogValue(error));
    },
    private readonly slug = MANAGED_SKILL_SLUG,
  ) {}

  async syncAll(agents: AgentSummary[]): Promise<void> {
    let content: string;
    try {
      content = await this.content();
    } catch (error) {
      this.reportFailure(this.sourcePath, error);
      return;
    }
    const results = await Promise.allSettled(
      agents.map((agent) => syncTargets(agent.workspacePath, content, this.slug)),
    );
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === "fulfilled") {
        this.reportResult(result.value);
      } else {
        this.reportFailure(agents[index]?.workspacePath ?? "unknown workspace", result.reason);
      }
    }
  }

  async syncAgent(agent: AgentSummary): Promise<void> {
    try {
      this.reportResult(await syncTargets(agent.workspacePath, await this.content(), this.slug));
    } catch (error) {
      this.reportFailure(agent.workspacePath, error);
    }
  }

  private async content(): Promise<string> {
    if (this.#content !== null) return this.#content;
    const content = await readFile(this.sourcePath, "utf8");
    if (!content.startsWith(`---\nname: ${this.slug}\n`)) {
      throw new Error("The managed site hosting skill is invalid.");
    }
    this.#content = content;
    return content;
  }

  private reportResult(result: SyncTargetsResult): void {
    for (const target of result.collisions) this.reportCollision(target);
    for (const failure of result.failures) this.reportFailure(failure.target, failure.error);
  }
}

async function syncTargets(workspacePath: string, content: string, slug: string): Promise<SyncTargetsResult> {
  const workspaceRoot = await realpath(resolve(workspacePath));
  const targets = [
    join(workspacePath, ".agents", "skills", slug, "SKILL.md"),
    join(workspacePath, ".claude", "skills", slug, "SKILL.md"),
  ];
  const resolvedTargets = [
    join(workspaceRoot, ".agents", "skills", slug, "SKILL.md"),
    join(workspaceRoot, ".claude", "skills", slug, "SKILL.md"),
  ];
  const results = await Promise.allSettled(
    resolvedTargets.map((target) => syncTarget(workspaceRoot, target, content, slug)),
  );
  const collisions: string[] = [];
  const failures: SyncTargetsResult["failures"] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const target = targets[index];
    if (!result || !target) continue;
    if (result.status === "rejected") failures.push({ target, error: result.reason });
    else if (result.value === "collision") collisions.push(target);
  }
  return { collisions, failures };
}

async function syncTarget(
  workspaceRoot: string,
  target: string,
  content: string,
  slug: string,
): Promise<"synced" | "collision"> {
  const ownershipContent = `${JSON.stringify({ managedBy: "danidex", slug, version: 1 })}\n`;
  const parent = dirname(target);
  await ensureSafeDirectory(workspaceRoot, parent);
  const marker = join(parent, OWNERSHIP_MARKER);
  await rejectSymlink(target);
  await rejectSymlink(marker);
  if (await fileExists(target)) {
    if ((await optionalText(marker)) !== ownershipContent) return "collision";
    await atomicWrite(workspaceRoot, target, content);
    return "synced";
  }
  try {
    await verifySafeDirectory(workspaceRoot, parent);
    await writeFile(target, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (isFileExistsError(error)) return "collision";
    throw error;
  }
  try {
    await atomicWrite(workspaceRoot, marker, ownershipContent);
  } catch (error) {
    await verifySafeDirectory(workspaceRoot, parent)
      .then(() => unlink(target))
      .catch(() => undefined);
    throw error;
  }
  return "synced";
}

async function atomicWrite(workspaceRoot: string, target: string, content: string): Promise<void> {
  const parent = dirname(target);
  await verifySafeDirectory(workspaceRoot, parent);
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  try {
    await verifySafeDirectory(workspaceRoot, parent);
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function ensureSafeDirectory(workspaceRoot: string, directory: string): Promise<void> {
  const path = containedRelativePath(workspaceRoot, directory);
  let current = workspaceRoot;
  for (const segment of path.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
    }
    await requireRealDirectory(current);
  }
  await verifySafeDirectory(workspaceRoot, directory);
}

async function verifySafeDirectory(workspaceRoot: string, directory: string): Promise<void> {
  const path = containedRelativePath(workspaceRoot, directory);
  await requireRealDirectory(workspaceRoot);
  let current = workspaceRoot;
  for (const segment of path.split(sep).filter(Boolean)) {
    current = join(current, segment);
    await requireRealDirectory(current);
  }
  const resolvedDirectory = await realpath(directory);
  if (!isInside(workspaceRoot, resolvedDirectory)) {
    throw new Error(`Managed skill target escapes its workspace: ${directory}`);
  }
}

function containedRelativePath(workspaceRoot: string, candidate: string): string {
  const path = relative(workspaceRoot, candidate);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Managed skill target escapes its workspace: ${candidate}`);
  }
  return path;
}

async function requireRealDirectory(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Managed skill path must be a real directory: ${path}`);
  }
}

async function rejectSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Managed skill path cannot be a symlink: ${path}`);
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function optionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/** Read only Dani-Dex-owned skills from the active provider's skill folder. */
export async function listManagedSkillsForChat(
  agent: Pick<AgentSummary, "workspacePath" | "provider">,
): Promise<InstalledSkill[]> {
  const root = await realpath(agent.workspacePath);
  const directory = join(root, agent.provider === "claude" ? ".claude" : ".agents", "skills");
  const skills: InstalledSkill[] = [];
  try {
    await verifySafeDirectory(root, directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const folder = join(directory, entry.name);
        await verifySafeDirectory(root, folder);
        const marker = join(folder, OWNERSHIP_MARKER);
        const file = join(folder, "SKILL.md");
        await rejectSymlink(marker);
        await rejectSymlink(file);
        if (
          (await optionalText(marker)) !== `${JSON.stringify({ managedBy: "danidex", slug: entry.name, version: 1 })}\n`
        )
          continue;
        const content = await readFile(file, "utf8");
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)?.[1];
        if (!frontmatter) continue;
        const metadata = parseYaml(frontmatter);
        if (!isDynamicRecord(metadata) || metadata.name !== entry.name || typeof metadata.description !== "string")
          continue;
        skills.push({
          skillId: entry.name,
          slug: entry.name,
          name: entry.name,
          description: metadata.description,
          installedVersion: 1,
          availableVersion: 1,
          enabled: true,
          state: "installed",
          origin: "managed",
        });
      } catch {
        /* Missing or invalid managed files are not selectable. */
      }
    }
  } catch {
    /* The workspace can have no managed skills yet. */
  }
  return skills;
}

export interface ManagedSkillFile {
  /** Relative to the skill folder, e.g. `SKILL.md` or `references/plan.md`. */
  path: string;
  content: string;
  executable?: boolean;
}

/**
 * Writes one Dani-Dex-owned skill, with any files beside its SKILL.md, into a workspace's
 * `.agents/skills` and `.claude/skills`. A folder the user made under the same name is left alone
 * and reported as a collision, exactly as for the single-file managed skills.
 */
export async function syncManagedSkillFiles(
  workspacePath: string,
  slug: string,
  files: readonly ManagedSkillFile[],
): Promise<SyncTargetsResult> {
  const skill = files.find((file) => file.path === "SKILL.md");
  if (!skill) throw new Error(`The ${slug} skill has no SKILL.md.`);
  const extras = files.filter((file) => file !== skill);
  const workspaceRoot = await realpath(resolve(workspacePath));
  const collisions: string[] = [];
  const failures: SyncTargetsResult["failures"] = [];
  for (const folder of [".agents", ".claude"]) {
    const target = join(workspaceRoot, folder, "skills", slug, "SKILL.md");
    try {
      if ((await syncTarget(workspaceRoot, target, skill.content, slug)) === "collision") {
        collisions.push(target);
        continue;
      }
      for (const extra of extras) {
        const path = join(dirname(target), extra.path);
        containedRelativePath(dirname(target), path);
        await ensureSafeDirectory(workspaceRoot, dirname(path));
        await rejectSymlink(path);
        await atomicWrite(workspaceRoot, path, extra.content);
        if (extra.executable) await chmod(path, 0o700);
      }
    } catch (error) {
      failures.push({ target, error });
    }
  }
  return { collisions, failures };
}

/**
 * Copies a scaffold into the workspace, one file at a time, never replacing a file that is already
 * there: the scaffold is a starting point the bot and the user go on to edit.
 */
export async function seedWorkspaceFiles(workspacePath: string, files: readonly ManagedSkillFile[]): Promise<void> {
  const workspaceRoot = await realpath(resolve(workspacePath));
  for (const file of files) {
    const path = join(workspaceRoot, file.path);
    containedRelativePath(workspaceRoot, path);
    await ensureSafeDirectory(workspaceRoot, dirname(path));
    await rejectSymlink(path);
    try {
      await writeFile(path, file.content, { encoding: "utf8", mode: file.executable ? 0o700 : 0o600, flag: "wx" });
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
    }
  }
}
