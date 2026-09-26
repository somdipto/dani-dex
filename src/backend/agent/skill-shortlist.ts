import type { InstalledSkill } from "@dani-dex/contracts/ipc";

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "can",
  "could",
  "each",
  "for",
  "from",
  "have",
  "into",
  "make",
  "need",
  "please",
  "that",
  "the",
  "them",
  "this",
  "those",
  "using",
  "want",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "your",
]);
const MAX_CANDIDATES = 3;

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !STOP_WORDS.has(word)));
}

/**
 * A bounded metadata shortlist, not permission or an instruction to execute a skill. The provider
 * still has to read the installed SKILL.md before using one. No skill body or remote content is
 * loaded here. This intentionally favors precision over recall; later user-task evaluations must
 * decide whether an additional semantic ranker is worth the complexity.
 */
export function shortlistInstalledSkills(prompt: string, skills: readonly InstalledSkill[]): InstalledSkill[] {
  const query = words(prompt.slice(0, 4_000));
  if (query.size === 0) return [];
  return skills
    .filter((skill) => skill.enabled !== false && skill.state === "installed")
    .map((skill) => {
      const name = words(`${skill.name} ${skill.slug}`);
      const description = words((skill.description ?? "").slice(0, 500));
      const score = [...query].reduce((total, word) => total + (name.has(word) ? 3 : description.has(word) ? 1 : 0), 0);
      return { skill, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.skill.skillId.localeCompare(right.skill.skillId))
    .slice(0, MAX_CANDIDATES)
    .map(({ skill }) => skill);
}
