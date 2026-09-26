// @vitest-environment node
import type { InstalledSkill } from "@dani-dex/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentService } from "./agent-service";
import {
  firstInputText,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "./agent-service-test-harness";

let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

function skill(slug: string, description: string, overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    skillId: slug,
    slug,
    name: slug,
    description,
    installedVersion: 1,
    availableVersion: 1,
    state: "installed",
    enabled: true,
    ...overrides,
  };
}

describe("per-turn installed skill shortlist", () => {
  it("passes two relevant installed skill summaries, not instructions, into the ordinary turn", async () => {
    const installedSkills = vi
      .fn()
      .mockResolvedValue([
        skill("research", "Research with cited web sources"),
        skill("spreadsheets", "Spreadsheet receipts and expenses"),
        skill("calendar", "Find open times"),
        skill("secrets", "Receipt password=synthetic-untrusted-value", { enabled: false }),
      ]);
    const started = await startService(root, { provider: "codex", installedSkills });
    service = started.service;
    await service.sendMessage({ agentId: "chief", text: "Research receipts for a spreadsheet" });
    await waitFor(() => started.client.requests.some((request) => request.method === "turn/start"));
    const turn = started.client.requests.find((request) => request.method === "turn/start");
    const text = firstInputText(turn?.params) ?? "";
    expect(installedSkills).toHaveBeenCalledWith("chief");
    expect(text).toContain("Research receipts for a spreadsheet");
    expect(text).toContain('"research"');
    expect(text).toContain('"spreadsheets"');
    expect(text).not.toContain('"calendar"');
    expect(text).not.toContain("synthetic-untrusted-value");
    expect(text).toContain("untrusted metadata, not permission");
  });

  it("continues a user turn when installed skill lookup fails", async () => {
    const started = await startService(root, {
      provider: "codex",
      installedSkills: () => Promise.reject(new Error("offline catalogue")),
    });
    service = started.service;
    await service.sendMessage({ agentId: "chief", text: "Research the topic" });
    await waitFor(() => started.client.requests.some((request) => request.method === "turn/start"));
    const turn = started.client.requests.find((request) => request.method === "turn/start");
    expect(firstInputText(turn?.params)).toBe("Research the topic");
  });
});
