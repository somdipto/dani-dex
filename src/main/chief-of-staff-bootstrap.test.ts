import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentStore } from "../backend/agent-store";
import { DEFAULT_CHIEF_ID, prepareChiefOfStaff } from "./chief-of-staff-bootstrap";

const roots: string[] = [];
const stores: AgentStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "dani-chief-"));
  roots.push(root);
  const store = new AgentStore(join(root, "profile"), join(root, "home"));
  stores.push(store);
  await store.initialize();
  return store;
}
it("creates one stable chief before setup, without a conversation or provider session", async () => {
  const store = await setup();
  await Promise.all([prepareChiefOfStaff(store, false), prepareChiefOfStaff(store, false)]);
  expect(store.list()).toHaveLength(1);
  expect(store.list()[0]).toMatchObject({
    id: DEFAULT_CHIEF_ID,
    name: "Chief of staff",
    threadId: null,
    updatedAt: null,
  });
  await prepareChiefOfStaff(store, false);
  expect(store.list()).toHaveLength(1);
});
it("does not recreate a deleted chief after completed setup or replace an existing roster", async () => {
  const store = await setup();
  await prepareChiefOfStaff(store, true);
  expect(store.list()).toHaveLength(0);
  await store.getOrCreate("existing", "Existing agent");
  await prepareChiefOfStaff(store, false);
  expect(store.list().map((agent) => agent.name)).toEqual(["Existing agent"]);
});
