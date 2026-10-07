import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseImportLocalContext } from "@dani-dex/contracts/context-import";
import { INPUT_LIMITS } from "@dani-dex/contracts/input-limits";
import type { CentralAuthState } from "@dani-dex/contracts/ipc";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMemoryStore } from "../backend/agent-memory-store";
import { DaniDexDatabase } from "../backend/dani-dex-database";
import { importLocalContext } from "./context-import-service";

let root: string;
let database: DaniDexDatabase;
let memories: AgentMemoryStore;
let state: CentralAuthState;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dani-dex-import-"));
  database = new DaniDexDatabase(root);
  await database.initialize();
  memories = new AgentMemoryStore(database);
  state = { status: "signed_out" };
});
afterEach(async () => {
  database.close();
  await rm(root, { recursive: true, force: true });
});
const scope = { accountId: null, serverId: "local", agentId: "chief" } as const;
function run(texts: string[]) {
  return importLocalContext(
    { ...scope, texts },
    {
      createMemory: (input) => memories.createManual(input.agentId, input.text),
      listMemories: (agentId) => memories.list(agentId),
    },
    { getState: () => state },
  );
}

it("replays through the real database without duplicate memories or creation events", () => {
  const text = "Imported from ChatGPT (historical): Uses Linux";
  expect(run([text, text])).toEqual({ saved: 1, failedTexts: [] });
  expect(run([text])).toEqual({ saved: 1, failedTexts: [] });
  expect(memories.list("chief")).toHaveLength(1);
  expect(
    database.connection
      .prepare("SELECT COUNT(*) AS count FROM orchestration_events WHERE event_type = 'agent-memory.created'")
      .get(),
  ).toMatchObject({ count: 1 });
});

it("redacts edited text even when its imported prefix was removed", () => {
  run(["My password is demo-secret-value"]);
  const events = database.connection.prepare("SELECT payload_json FROM orchestration_events").all();
  expect(JSON.stringify({ events, memories: memories.list("chief") })).not.toContain("demo-secret-value");
});

it("rejects a changed account before any read or write, and works again in the original local profile", () => {
  state = {
    status: "signed_in",
    user: { id: "another-owner", name: "Other", email: "other@example.invalid", avatarUrl: null },
  };
  const createMemory = vi.fn();
  const listMemories = vi.fn();
  expect(() =>
    importLocalContext(
      { ...scope, texts: ["Private context"] },
      { createMemory, listMemories },
      { getState: () => state },
    ),
  ).toThrow("another account");
  expect(createMemory).not.toHaveBeenCalled();
  expect(listMemories).not.toHaveBeenCalled();
  state = { status: "signed_out" };
  expect(run(["Private context"]).saved).toBe(1);
});

it("keeps unsaved entries when capacity is reached and can retry saved entries at the limit", () => {
  for (let i = 0; i < INPUT_LIMITS.agentMemories; i++) memories.createManual("chief", `Memory ${i}`);
  expect(run(["Memory 0", "Overflow"])).toEqual({ saved: 1, failedTexts: ["Overflow"] });
});

it("requires source-of-truth readback before reporting success", () => {
  const memory = memories.createManual("chief", "Readback test");
  expect(
    importLocalContext(
      { ...scope, texts: [memory.text] },
      {
        createMemory: () => memory,
        listMemories: () => [],
      },
      { getState: () => state },
    ),
  ).toEqual({ saved: 0, failedTexts: [memory.text] });
});

it("rejects remote, ambiguous-account and over-limit IPC payloads before processing", () => {
  for (const input of [
    { ...scope, serverId: "remote", texts: ["Private context"] },
    { serverId: "local", agentId: "chief", texts: ["Private context"] },
    { ...scope, texts: ["x".repeat(INPUT_LIMITS.agentMemoryText + 1)] },
    { ...scope, texts: Array.from({ length: INPUT_LIMITS.agentMemories + 1 }, () => "Context") },
  ])
    expect(() => parseImportLocalContext(input)).toThrow("Invalid local context import");
});

it("blocks an unresolved account instead of assigning its import to the local profile", () => {
  state = { status: "loading" };
  expect(() => run(["Private context"])).toThrow("account to load");
  expect(memories.list("chief")).toEqual([]);
});
