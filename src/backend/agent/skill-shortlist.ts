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
  if (/^\s*Hi\. Tell me briefly how you can help\.\s*$/i.test(prompt)) return [];
  const sentences = prompt.toLowerCase().split(/[.!?;\n]/);
  // Explicit exclusions outrank lexical relevance. A negative list can mention skills last.
  const excludesSkills = sentences.some((sentence) =>
    /\b(?:no|without)\b[^.!?;\n]{0,160}\bskills?\b/.test(sentence) ||
    /\b(?:do not|don't|never)\s+(?:use|select|choose|invoke|load|read)\s+(?:any\s+|a\s+|the\s+)?skills?\b/.test(sentence));
  if (excludesSkills) return [];
  const excludesAudit = /\b(?:do not|don't|never)\s+audit\b|\bno\s+(?:codebase\s+|code\s+)?audit\b/i.test(prompt);
  const query = words(prompt.slice(0, 4_000));
  if (query.size === 0) return [];
  return skills
    .filter((skill) => skill.enabled !== false && skill.state === "installed" &&
      !(excludesAudit && /(?:^|[- :])audit(?:$|[- :])/i.test(`${skill.slug} ${skill.name}`)))
    .map((skill) => {
      const name = words(`${skill.name} ${skill.slug}`);
      const description = words((skill.description ?? "").slice(0, 500));
      const auditIntent = /\baudit\b/i.test(prompt);
      const auditSkill = /(?:^|[- :])audit(?:$|[- :])/i.test(`${skill.slug} ${skill.name}`);
      const score = (auditIntent && auditSkill ? 30 : 0) + [...query].reduce((total, word) => total + (name.has(word) ? 3 : description.has(word) ? 1 : 0), 0);
      return { skill, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.skill.skillId.localeCompare(right.skill.skillId))
    .slice(0, MAX_CANDIDATES)
    .map(({ skill }) => skill);
}
