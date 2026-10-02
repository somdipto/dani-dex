import type { InstalledSkill } from "@dani-dex/contracts/ipc";
import { describe, expect, it } from "vitest";
import { shortlistInstalledSkills } from "./skill-shortlist";

function skill(id: string, description: string, overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    skillId: id,
    slug: id,
    name: id,
    description,
    installedVersion: 1,
    availableVersion: 1,
    state: "installed",
    enabled: true,
    ...overrides,
  };
}

describe("installed skill metadata shortlist", () => {
  it.each([
    "Hi. Tell me briefly how you can help.",
    "Text-only, no tools, files, commands, network or skills. Turn these notes into a four-line release checklist: test onboarding, check error messages, confirm cancellation, inspect permissions. Do not audit anything.",
    "Do not use any skills. Audit is only a word in this checklist.",
    "Without skills, write a release checklist.",
  ])("respects greeting and explicit skill exclusion: %s", (prompt) => {
    expect(
      shortlistInstalledSkills(prompt, [
        skill("ponytail-audit", "audit release checklist"),
        skill("ponytail-help", "help"),
      ]),
    ).toEqual([]);
  });
  it("excludes audit without excluding another explicitly requested skill", () => {
    expect(
      shortlistInstalledSkills("Do not audit anything. Use the writing skill to write a document.", [
        skill("ponytail-audit", "audit document"),
        skill("writing", "write a document"),
      ]).map((s) => s.slug),
    ).toEqual(["writing"]);
  });
  it("ranks an audit skill over generic skill-creation wording for a code audit", () => {
    expect(
      shortlistInstalledSkills(
        "Audit source code, choose the best installed skill and read SKILL.md, report findings",
        [
          skill("dani-dex-skill-creator", "Read source code and report installed skill creation"),
          skill("ponytail-audit", "Codebase audit"),
        ],
      )[0]?.slug,
    ).toBe("ponytail-audit");
  });
  it("returns multiple relevant installed skills in a stable bounded order", () => {
    const skills = [
      skill("calendar", "Find free times"),
      skill("research", "Research the web and cite sources"),
      skill("spreadsheets", "Make a spreadsheet from receipts"),
      skill("documents", "Create a document"),
    ];
    expect(
      shortlistInstalledSkills("Research receipts and make a spreadsheet", skills).map((item) => item.slug),
    ).toEqual(["research", "spreadsheets"]);
    expect(shortlistInstalledSkills("Make a document spreadsheet research calendar", skills)).toHaveLength(3);
  });

  it("returns nothing for no match, stop words, disabled and broken skills", () => {
    const skills = [
      skill("research", "Search the web", { enabled: false }),
      skill("spreadsheets", "Make spreadsheets", { state: "modified" }),
    ];
    expect(shortlistInstalledSkills("Please make a spreadsheet and research it", skills)).toEqual([]);
    expect(shortlistInstalledSkills("Please can you make this for me?", [skill("research", "Search web")])).toEqual([]);
  });

  it("reads names and bounded descriptions only, never skill instructions", () => {
    const longDescription = `${"ordinary ".repeat(70)}magicword`;
    const skills = [skill("research", longDescription)];
    expect(shortlistInstalledSkills("magicword", skills)).toEqual([]);
    expect(shortlistInstalledSkills("RESEARCH", skills)).toEqual(skills);
  });

  it("does not mutate the input and breaks ties by stable id", () => {
    const skills = [skill("zeta", "read sources"), skill("alpha", "read sources")];
    expect(shortlistInstalledSkills("sources", skills).map((item) => item.skillId)).toEqual(["alpha", "zeta"]);
    expect(skills.map((item) => item.skillId)).toEqual(["zeta", "alpha"]);
  });
});
