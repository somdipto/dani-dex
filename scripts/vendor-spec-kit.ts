/**
 * Renders github/spec-kit (MIT) into the technical skill pack Dani-Dex ships.
 *
 * spec-kit's own installer (`specify init --integration <agent>`) turns its command templates into
 * skills and copies a `.specify/` scaffold into the project. This does the same once, at a pinned
 * commit, so the installer ships the result and a bot needs no Python CLI. Re-run it to move the pin:
 *
 *   node --experimental-strip-types scripts/vendor-spec-kit.ts <path-to-extracted-spec-kit> <commit>
 */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [sourceArgument, commit] = process.argv.slice(2);
if (!sourceArgument || !commit || !/^[0-9a-f]{40}$/u.test(commit)) {
  throw new Error("Usage: vendor-spec-kit.ts <extracted spec-kit directory> <40-character commit>");
}
const source = resolve(sourceArgument);
const output = resolve(import.meta.dirname, "../resources/skill-packs/spec-kit");

/** How a skill refers to its neighbours, e.g. `/speckit-plan`. */
function commandReference(name: string): string {
  return `/speckit-${name.toLowerCase().replaceAll("_", "-")}`;
}

function frontmatter(content: string): { data: string; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(content);
  if (!match) throw new Error("A spec-kit command template has no frontmatter.");
  return { data: match[1] ?? "", body: content.slice(match[0].length) };
}

function field(data: string, key: string): string | null {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "mu").exec(data);
  return match?.[1]?.trim().replace(/^["']|["']$/gu, "") ?? null;
}

function scriptCommand(data: string): string | null {
  const block = /^scripts:\n((?:[ \t]+.*\n?)*)/mu.exec(data)?.[1] ?? "";
  return /^\s+sh:\s*(.+)$/mu.exec(block)?.[1]?.trim() ?? null;
}

/** The same path rewrite spec-kit applies when it installs into a project. */
function rewritePaths(text: string): string {
  return text
    .replaceAll("../../memory/", ".specify/memory/")
    .replaceAll("../../scripts/", ".specify/scripts/")
    .replaceAll("../../templates/", ".specify/templates/")
    .replace(/(^|[\s`"'(])(?:\.?\/)?memory\//gmu, "$1.specify/memory/")
    .replace(/(^|[\s`"'(])(?:\.?\/)?scripts\//gmu, "$1.specify/scripts/")
    .replace(/(^|[\s`"'(])(?:\.?\/)?templates\//gmu, "$1.specify/templates/")
    .replaceAll(".specify/.specify/", ".specify/");
}

rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, "skills"), { recursive: true });

const commandsDirectory = join(source, "templates", "commands");
const skills: string[] = [];
for (const file of readdirSync(commandsDirectory)
  .filter((name) => name.endsWith(".md"))
  .sort()) {
  const command = file.slice(0, -3);
  const slug = `speckit-${command}`;
  const { data, body } = frontmatter(readFileSync(join(commandsDirectory, file), "utf8"));
  const description = field(data, "description");
  if (!description) throw new Error(`${file} has no description.`);
  const script = scriptCommand(data);
  let rendered = body;
  if (script) rendered = rendered.replaceAll("{SCRIPT}", script);
  rendered = rendered
    .replaceAll("{ARGS}", "the user's request")
    .replaceAll("$ARGUMENTS", "(the user's request in this conversation)")
    .replaceAll("__AGENT__", "dani-dex")
    .replace(/__SPECKIT_COMMAND_([A-Z][A-Z0-9_-]*)__/gu, (_match, name: string) => commandReference(name));
  rendered = rewritePaths(rendered);
  const skill = [
    "---",
    `name: ${slug}`,
    `description: ${JSON.stringify(`Spec-driven development (spec-kit): ${description}`)}`,
    "license: MIT (github/spec-kit)",
    "---",
    "",
    "> Part of spec-kit's spec-driven workflow: constitution, specify, clarify, plan, tasks, analyze, implement.",
    "> It works in the project's `.specify/` folder, which Dani-Dex sets up in this workspace.",
    "",
    rendered.trimStart(),
  ].join("\n");
  mkdirSync(join(output, "skills", slug), { recursive: true });
  writeFileSync(join(output, "skills", slug, "SKILL.md"), skill);
  skills.push(slug);
}

// The `.specify/` scaffold `specify init` would create: bash scripts, templates, and the
// constitution the first command fills in.
const scaffold = join(output, "workspace", ".specify");
mkdirSync(join(scaffold, "scripts", "bash"), { recursive: true });
mkdirSync(join(scaffold, "templates"), { recursive: true });
mkdirSync(join(scaffold, "memory"), { recursive: true });
for (const file of readdirSync(join(source, "scripts", "bash")).filter((name) => name.endsWith(".sh"))) {
  copyFileSync(join(source, "scripts", "bash", file), join(scaffold, "scripts", "bash", file));
}
for (const file of readdirSync(join(source, "templates")).filter((name) => name.endsWith("-template.md"))) {
  copyFileSync(join(source, "templates", file), join(scaffold, "templates", file));
}
copyFileSync(join(source, "templates", "constitution-template.md"), join(scaffold, "memory", "constitution.md"));

copyFileSync(join(source, "LICENSE"), join(output, "LICENSE"));
writeFileSync(
  join(output, "SOURCE.json"),
  `${JSON.stringify({ repository: "github/spec-kit", commit, license: "MIT", skills }, null, 2)}\n`,
);
process.stdout.write(`Rendered ${skills.length} spec-kit skills at ${commit}.\n`);
