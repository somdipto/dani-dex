import { OPERATING_INSTRUCTIONS_REFRESH_TURNS } from "@dani-dex/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  createTestService,
  FakeAgentClient,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";
import { getString, isRecord } from "./protocol";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: operating instructions", () => {
  it("rewrites a bot's operating instructions after ten user turns and starts its next session with them", async () => {
    const { store, mailbox } = stores(root);
    const clients: FakeAgentClient[] = [];
    service = createTestService({
      store,
      mailbox,
      preferredProvider: "codex",
      clientFactory: (provider: AgentProvider) => {
        const client = new FakeAgentClient(provider, "- Write the spec before the code.");
        client.configRead = { config: {} };
        clients.push(client);
        return client;
      },
    });
    await service.initialize();
    const running = service;
    for (let turn = 1; turn <= OPERATING_INSTRUCTIONS_REFRESH_TURNS; turn++) {
      await running.sendMessage({ agentId: "chief", text: `Step ${turn}: spec first, then code.` });
      await waitFor(() => running.listQueue("chief").deliveries.every((item) => item.status === "completed"));
    }
    await waitFor(() => running.getOperatingInstructions("chief").source === "generated");
    expect(running.getOperatingInstructions("chief")).toMatchObject({
      text: "- Write the spec before the code.",
      revision: 1,
      userTurns: OPERATING_INSTRUCTIONS_REFRESH_TURNS,
      turnsUntilRefresh: OPERATING_INSTRUCTIONS_REFRESH_TURNS,
    });
    // The rewrite ran in a throwaway, tool-less session and read the user's own words.
    const rewrite = clients
      .flatMap((client) => client.requests)
      .find((request) => request.method === "turn/start" && JSON.stringify(request.params).includes("<user_messages>"));
    expect(JSON.stringify(rewrite?.params)).toContain("Step 10: spec first, then code.");

    // The user's edit is what the next turn's session is started with.
    running.updateOperatingInstructions({ agentId: "chief", text: "- Review every diff before commit." });
    const sessionsBefore = agentSessions(clients).length;
    await running.sendMessage({ agentId: "chief", text: "Next task." });
    await waitFor(() => running.listQueue("chief").deliveries.every((item) => item.status === "completed"));
    const sessions = agentSessions(clients);
    expect(sessions.length).toBeGreaterThan(sessionsBefore);
    const instructions = sessions.at(-1) ?? "";
    expect(instructions).toContain(
      "<operating_instructions>\n- Review every diff before commit.\n</operating_instructions>",
    );
  });
});

/** The developer instructions of every session the bot itself was started or resumed with, in order. */
function agentSessions(clients: FakeAgentClient[]): string[] {
  return clients
    .flatMap((client) => client.requests)
    .filter((request) => request.method === "thread/start" || request.method === "thread/resume")
    .map((request) => (isRecord(request.params) ? getString(request.params, "developerInstructions") : null) ?? "")
    .filter((text) => text.includes("<agent_profile>"));
}
