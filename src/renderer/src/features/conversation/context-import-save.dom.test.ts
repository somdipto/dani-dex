import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMockDaniDex, type MockDaniDexControls } from "../../preview/mock-dani-dex";
import { commitStagedImport, pendingImportTexts, saveEntriesOnce, setPendingImportTexts } from "./context-import-save";

let mock: MockDaniDexControls;
beforeEach(() => {
  localStorage.clear();
  mock = createMockDaniDex();
  window.danidex = mock.api;
});
afterEach(() => {
  mock.dispose();
  localStorage.clear();
});

it("retains a redacted durable copy before setup and surfaces storage failure", () => {
  setPendingImportTexts(["My password is demo-secret-value", "Uses Linux"]);
  expect(pendingImportTexts()).toEqual(["My [redacted]", "Uses Linux"]);
  expect(JSON.stringify(localStorage)).not.toContain("demo-secret-value");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage full");
  });
  expect(() => setPendingImportTexts(["New batch"])).toThrow("Storage full");
  expect(pendingImportTexts()).toContain("Uses Linux");
});

it("keeps staged entries after a host failure without polling or completing them", async () => {
  const list = vi.spyOn(mock.api.agent, "listMemories").mockRejectedValue(new Error("Offline"));
  setPendingImportTexts(["First batch"]);
  await expect(commitStagedImport(["Second batch"])).resolves.toEqual(["First batch", "Second batch"]);
  expect(list).toHaveBeenCalledOnce();
  expect(pendingImportTexts()).toEqual(["First batch", "Second batch"]);
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
