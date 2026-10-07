import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMockDaniDex, type MockDaniDexControls } from "../../preview/mock-dani-dex";
import { installImportLocksStub } from "./context-import-locks.test-helper";
import {
  adoptLegacyImport,
  commitStagedImport,
  legacyPendingImportTexts,
  pendingImportTexts,
  saveEntriesOnce,
  setPendingImportTexts,
} from "./context-import-save";

let restoreLocks: () => void;
const scope = { accountId: null, serverId: "local", agentId: "chief" } as const;
let mock: MockDaniDexControls;
beforeEach(() => {
  localStorage.clear();
  restoreLocks = installImportLocksStub();
  mock = createMockDaniDex({ authState: { status: "signed_out" } });
  window.danidex = mock.api;
});
afterEach(() => {
  restoreLocks();
  mock.dispose();
  localStorage.clear();
});

it("retains a redacted durable copy before setup and surfaces storage failure", async () => {
  await setPendingImportTexts(scope, ["My password is demo-secret-value", "Uses Linux"]);
  expect(pendingImportTexts(scope)).toEqual(["My [redacted]", "Uses Linux"]);
  expect(JSON.stringify(localStorage)).not.toContain("demo-secret-value");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage full");
  });
  await expect(setPendingImportTexts(scope, ["New batch"])).rejects.toThrow("Storage full");
  expect(pendingImportTexts(scope)).toContain("Uses Linux");
});

it("keeps staged entries after a host failure without polling or completing them", async () => {
  const list = vi.spyOn(mock.api.agent, "importLocalContext").mockRejectedValue(new Error("Offline"));
  await setPendingImportTexts(scope, ["First batch"]);
  await expect(commitStagedImport(scope, ["Second batch"])).resolves.toEqual(["First batch", "Second batch"]);
  expect(list).toHaveBeenCalledOnce();
  expect(pendingImportTexts(scope)).toEqual(["First batch", "Second batch"]);
});

it("keeps only failed entries and retries without creating saved duplicates", async () => {
  const saved = new Set<string>();
  let rejectSecond = true;
  const create = vi.fn(async (text: string) => {
    if (text === "Second" && rejectSecond) throw new Error("Full");
    saved.add(text);
  });
  const list = async () => [...saved];
  const failed = await saveEntriesOnce(list, create, ["First", "First", "Second"]);
  expect(failed).toEqual(["Second"]);
  rejectSecond = false;
  await expect(saveEntriesOnce(list, create, ["First", ...failed])).resolves.toEqual([]);
  expect(create.mock.calls.filter(([text]) => text === "First")).toHaveLength(1);
});

it("holds legacy imports until an explicit destination review", async () => {
  localStorage.setItem("dani-dex.pending-context-import", JSON.stringify(["Uses Linux"]));
  const send = vi.spyOn(mock.api.agent, "importLocalContext");
  expect(pendingImportTexts(scope)).toEqual([]);
  await commitStagedImport(scope, []);
  expect(send).not.toHaveBeenCalled();
  expect(legacyPendingImportTexts()).toEqual(["Uses Linux"]);
  await adoptLegacyImport(scope, ["Uses Linux"]);
  expect(pendingImportTexts(scope)).toEqual(["Uses Linux"]);
  expect(legacyPendingImportTexts()).toEqual([]);
});

it("isolates account and agent batches across restarts", async () => {
  await setPendingImportTexts(scope, ["Private local context"]);
  expect(pendingImportTexts({ ...scope, accountId: "other" })).toEqual([]);
  expect(pendingImportTexts({ ...scope, agentId: "another-agent" })).toEqual([]);
  expect(pendingImportTexts(scope)).toEqual(["Private local context"]);
});

it("retains newly staged text when an older save finishes", async () => {
  let finish: ((result: { saved: number; failedTexts: string[] }) => void) | undefined;
  vi.spyOn(mock.api.agent, "importLocalContext").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saving = commitStagedImport(scope, ["First"]);
  await vi.waitFor(() => expect(finish).toBeDefined());
  await setPendingImportTexts(scope, ["First", "Added during save"]);
  finish?.({ saved: 1, failedTexts: [] });
  await expect(saving).resolves.toEqual(["Added during save"]);
});

it("retries a lost response without adding another memory", async () => {
  const original = mock.api.agent.importLocalContext;
  vi.spyOn(mock.api.agent, "importLocalContext").mockImplementationOnce(async (input) => {
    await original(input);
    throw new Error("Response lost after commit");
  });
  await expect(commitStagedImport(scope, ["Uses Linux"])).resolves.toEqual(["Uses Linux"]);
  await expect(commitStagedImport(scope, [])).resolves.toEqual([]);
  expect(await mock.api.agent.listMemories("chief")).toHaveLength(1);
});

it("keeps a damaged batch for recovery instead of overwriting or deleting it", async () => {
  await setPendingImportTexts(scope, ["Private context"]);
  const key = localStorage.key(0);
  if (!key) throw new Error("No staged batch");
  localStorage.setItem(key, "damaged data");
  expect(pendingImportTexts(scope)).toEqual([]);
  await expect(setPendingImportTexts(scope, ["New context"])).rejects.toThrow();
  expect(localStorage.getItem(key)).toBe("damaged data");
});

it("retains both windows' entries when staging starts at the same time", async () => {
  await Promise.all([setPendingImportTexts(scope, ["First window"]), setPendingImportTexts(scope, ["Second window"])]);
  expect(pendingImportTexts(scope)).toEqual(["First window", "Second window"]);
});

it("holds existing data and does not send when cross-window locking is unavailable", async () => {
  await setPendingImportTexts(scope, ["Private context"]);
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  const send = vi.spyOn(mock.api.agent, "importLocalContext");
  await expect(commitStagedImport(scope, [])).rejects.toThrow("Safe import storage is unavailable");
  expect(pendingImportTexts(scope)).toEqual(["Private context"]);
  expect(send).not.toHaveBeenCalled();
});
