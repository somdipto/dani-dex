import type { AgentTaskKind } from "./agent-harness-routing";

/**
 * Skill packs: sets of skills a bot gets from what it was created as.
 *
 * The base pack is the Dani-Dex skills every bot already has. The technical pack adds engineering
 * workflows for bots classified technical. Licensing decides how a pack travels: a pack with a
 * license that allows it ships inside the installer; a pack without one is never bundled, and is
 * downloaded on the user's machine at first use, from a pinned commit, checked against a pinned hash.
 */
export type SkillPackSource =
  | {
      /** Rendered into `resources/skill-packs/<directory>` and shipped with the app. */
      kind: "bundled";
      directory: string;
      license: string;
    }
  | {
      /** Fetched from GitHub at a pinned commit; never part of the installer. */
      kind: "github";
      repository: string;
      commit: string;
      files: readonly { slug: string; path: string; sha256: string }[];
    };

export interface SkillPack {
  id: string;
  title: string;
  /** Which bots receive it. */
  roles: readonly AgentTaskKind[];
  source: SkillPackSource;
  /** Where the pack came from, for Settings and the notice. */
  homepage: string;
}

export const SKILL_PACKS: readonly SkillPack[] = [
  {
    id: "spec-kit",
    title: "Spec-driven development (github/spec-kit)",
    roles: ["technical"],
    source: { kind: "bundled", directory: "spec-kit", license: "MIT" },
    homepage: "https://github.com/github/spec-kit",
  },
  {
    id: "karpathy-guidelines",
    title: "Karpathy coding guidelines",
    roles: ["technical"],
    // The repository has no license file, so the skill is fetched on the user's machine.
    source: {
      kind: "github",
      repository: "multica-ai/andrej-karpathy-skills",
      commit: "2c606141936f1eeef17fa3043a72095b4765b9c2",
      files: [
        {
          slug: "karpathy-guidelines",
          path: "skills/karpathy-guidelines/SKILL.md",
          sha256: "6e22cc54cb02a5e98ae42d06d9d7292db0c1b43894831b32879beb0166b2aea7",
        },
      ],
    },
    homepage: "https://github.com/multica-ai/andrej-karpathy-skills",
  },
];

export function skillPacksForRole(kind: AgentTaskKind): SkillPack[] {
  return SKILL_PACKS.filter((pack) => pack.roles.includes(kind));
}
