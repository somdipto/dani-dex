import type { AgentHarnessId } from "./agent-harnesses";
import { isOneOf } from "./runtime-values";

/**
 * The harness setting. `automatic` routes each new conversation by what it asks for: technical
 * work to OMP, everything else to Hermes. The fixed choices run every conversation on one harness.
 */
export const AGENT_HARNESS_SETTINGS = ["automatic", "hermes", "omp"] as const;
export type AgentHarnessSetting = (typeof AGENT_HARNESS_SETTINGS)[number];

export function isAgentHarnessSetting(value: unknown): value is AgentHarnessSetting {
  return isOneOf(AGENT_HARNESS_SETTINGS, value);
}

export type AgentTaskKind = "technical" | "general";

/** Which harnesses this install can start right now. OMP stays false until it ships verified. */
export interface HarnessAvailability {
  readonly hermes: boolean;
  readonly omp: boolean;
}

export interface TaskClassification {
  readonly kind: AgentTaskKind;
  /** The signals that decided it, for the route record and tests. Empty for a general task. */
  readonly signals: readonly string[];
}

export interface HarnessRoute {
  readonly kind: AgentTaskKind;
  /** The harness the conversation runs on. `null` is each provider's own CLI. */
  readonly harness: AgentHarnessId | null;
  /** The harness the router wanted when it had to fall back, otherwise `null`. */
  readonly wanted: AgentHarnessId | null;
}

/** The harness each kind of work belongs on. */
export const HARNESS_FOR_TASK: Record<AgentTaskKind, AgentHarnessId> = {
  technical: "omp",
  general: "hermes",
};

// Each rule is one kind of evidence. Two independent kinds, or one strong one, make a task
// technical: a single word like "server" or "bug" turns up in everyday requests too.
const STRONG_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["code block", /```/u],
  [
    "stack trace",
    /\b(?:Traceback \(most recent call last\)|at [\w$.<>]+ \([^)]*:\d+:\d+\)|Exception in thread|panicked at)/u,
  ],
  [
    "source file",
    /(?:^|[\s(`'"])[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|rb|php|c|cc|cpp|h|hpp|cs|sh|sql|ya?ml|toml|lock|gradle|tf)\b/mu,
  ],
  [
    "shell command",
    /(?:^|\n)\s*(?:\$ |(?:npm|npx|pnpm|yarn|bun|pip|uv|cargo|git|docker|kubectl|make|go|brew|terraform) [\w-])/u,
  ],
];

// Words that rarely mean anything but software. Everyday words that also name code ("class",
// "function", "commit", "branch") are left out, since "commit to the class schedule" is not a task
// for an engineering harness. Each distinct term found counts once.
const ENGINEERING_TERMS =
  /\b(?:refactor(?:ing)?|debug(?:ging|ger)?|compil(?:e|er|ing)|regex|endpoints?|api|sdk|cli|repo(?:sitory)?|pull request|merge conflict|deploy(?:ment|ing)?|unit tests?|test suite|typescript|javascript|python|rust|golang|kotlin|react|node\.?js|sql|postgres(?:ql)?|docker|kubernetes|backend|frontend|null pointer|segfault|runtime error|linter|package\.json|webhook|localhost|oauth|json|yaml|github|gitlab|codebase|source code|stack ?trace)\b/giu;

const WEAK_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["code identifier", /\b[a-z]+(?:[A-Z][a-z0-9]+)+\(|\b[a-z]+_[a-z_]+\(/u],
  [
    "error text",
    /\b(?:TypeError|ReferenceError|SyntaxError|ENOENT|EACCES|ECONNREFUSED|exit code \d+|error\[E\d+\]|HTTP [45]\d\d)\b/u,
  ],
];

function engineeringTerms(text: string): string[] {
  return [...new Set([...text.matchAll(ENGINEERING_TERMS)].map((match) => match[0].toLowerCase()))];
}

/**
 * Sorts a new conversation into technical or general work from its first message and, when set,
 * the agent's stated purpose. Rule-based on purpose: it answers instantly, costs nothing and never
 * sends the message anywhere. It sits behind this one function so a model classifier can replace it.
 */
export function classifyTask(input: { text: string; purpose?: string | null }): TaskClassification {
  const text = input.text;
  const purpose = input.purpose ?? "";
  const signals: string[] = [];
  for (const [name, rule] of STRONG_RULES) if (rule.test(text)) signals.push(name);
  if (signals.length > 0) return { kind: "technical", signals };
  for (const [name, rule] of WEAK_RULES) if (rule.test(text)) signals.push(name);
  for (const term of engineeringTerms(text)) signals.push(`term: ${term}`);
  // A coding agent's purpose counts as one piece of evidence, so "fix the login" to an agent set up
  // for engineering work is technical while the same words to a travel agent are not.
  if (engineeringTerms(purpose).length > 0) signals.push("agent purpose");
  return signals.length >= 2 ? { kind: "technical", signals } : { kind: "general", signals: [] };
}

// Job titles that name engineering work on their own, so a bot called "CTO" is technical before it
// has a purpose written down.
const TECHNICAL_ROLES =
  /\b(?:cto|vp of engineering|engineer(?:ing)?|developer|dev|devops|sre|programmer|coder|software|tech lead|architect|qa|tester|data scientist|ml|machine learning|full[- ]?stack|back[- ]?end|front[- ]?end|mobile dev|security researcher|hacker)\b/iu;

/**
 * Sorts a bot into technical or general work from what it was created as: a technical job title in
 * its name or title decides it, otherwise its purpose is read the way a first message would be.
 */
export function classifyAgentRole(agent: {
  name: string;
  title?: string | null;
  description?: string | null;
}): TaskClassification {
  const role = `${agent.name} ${agent.title ?? ""}`;
  const match = TECHNICAL_ROLES.exec(role);
  if (match) return { kind: "technical", signals: [`role: ${match[0].toLowerCase()}`] };
  return classifyTask({ text: agent.description ?? "", purpose: role });
}

/**
 * Where work of `kind` runs. It only ever picks a harness that is available, so an
 * unavailable OMP sends technical work to Hermes, and a missing Hermes leaves the provider's own
 * CLI. It never fails open onto a harness this install cannot start.
 */
export function routeHarness(kind: AgentTaskKind, available: HarnessAvailability): HarnessRoute {
  const wanted = HARNESS_FOR_TASK[kind];
  if (available[wanted]) return { kind, harness: wanted, wanted: null };
  const harness = available.hermes ? "hermes" : null;
  return { kind, harness, wanted };
}

/** The harness a fixed setting runs, with the same never-fail-open rule as the router. */
export function fixedHarness(setting: AgentHarnessId, available: HarnessAvailability): AgentHarnessId | null {
  if (available[setting]) return setting;
  return available.hermes ? "hermes" : null;
}

/** One line for the conversation's route record, e.g. "Technical - Hermes (OMP not installed)". */
export function describeHarnessRoute(route: HarnessRoute): string {
  const kind = route.kind === "technical" ? "Technical" : "General";
  const runner = route.harness === null ? "provider CLI" : route.harness === "hermes" ? "Hermes" : "OMP";
  if (!route.wanted) return `${kind} - ${runner}`;
  return `${kind} - ${runner} (${route.wanted === "omp" ? "OMP" : "Hermes"} not installed)`;
}
