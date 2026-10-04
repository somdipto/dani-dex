import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { DaniDexDatabase } from "../dani-dex-database";
import { HarmlessEffectExecutor } from "./harmless-effect-executor";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dani-approved-effect-"));
  const database = new DaniDexDatabase(root);
  await database.initialize();
  const executor = new HarmlessEffectExecutor(database, "uid:501", () => 1000);
  await executor.initialize();
  return {
    root,
    database,
    executor,
    close: async () => {
      database.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("requires stored native approval and produces a separate file receipt only once", async () => {
  const f = await fixture();
  try {
    const proposal = f.executor.propose();
    await expect(f.executor.dispatch(proposal.id, "invented-grant")).rejects.toThrow("denied");
    expect(await readdir(join(f.root, "harmless-receipts"))).toEqual([]);
    const grant = f.executor.approve(proposal.id, { issuer: "uid:501", source: "native-dialog", approvedAt: 1000 });
    expect(await f.executor.dispatch(proposal.id, grant.id)).toMatchObject({ phase: "succeeded" });
    const receipt = JSON.parse(await readFile(join(f.root, "harmless-receipts", `${proposal.id}.json`), "utf8"));
    expect(receipt.operationId).toBe(proposal.id);
    expect(receipt.payload).toEqual(proposal.payload);
    await expect(f.executor.dispatch(proposal.id, grant.id)).rejects.toThrow("denied");
    expect(await readdir(join(f.root, "harmless-receipts"))).toEqual([`${proposal.id}.json`]);
  } finally {
    await f.close();
  }
});

it("rejects issuer substitution, stale approvals and guessed IDs without effects", async () => {
  const f = await fixture();
  try {
    const proposal = f.executor.propose();
    expect(() =>
      f.executor.approve(proposal.id, { issuer: "uid:999", source: "native-dialog", approvedAt: 1000 }),
    ).toThrow("denied");
    f.executor.cancel();
    expect(() =>
      f.executor.approve(proposal.id, { issuer: "uid:501", source: "native-dialog", approvedAt: 1000 }),
    ).toThrow("denied");
    expect(() => f.executor.proposal(proposal.id, "uid:999")).toThrow("denied");
    expect(await readdir(join(f.root, "harmless-receipts"))).toEqual([]);
  } finally {
    await f.close();
  }
});

it("keeps a lost response fenced across restart and reconciles the actual file", async () => {
  const f = await fixture();
  try {
    const proposal = f.executor.propose();
    const grant = f.executor.approve(proposal.id, { issuer: "uid:501", source: "native-dialog", approvedAt: 1000 });
    const perform = f.executor.adapter.perform.bind(f.executor.adapter);
    vi.spyOn(f.executor.adapter, "perform").mockImplementationOnce(async (operation, payload) => {
      await perform(operation, payload);
      throw new Error("response lost");
    });
    expect(await f.executor.dispatch(proposal.id, grant.id)).toMatchObject({ phase: "unknown" });
    f.database.close();
    await f.database.initialize();
    const restarted = new HarmlessEffectExecutor(f.database, "uid:501", () => 1000);
    await restarted.initialize();
    await expect(restarted.dispatch(proposal.id, grant.id)).rejects.toThrow("denied");
    const next = restarted.propose();
    const nextGrant = restarted.approve(next.id, { issuer: "uid:501", source: "native-dialog", approvedAt: 1000 });
    await expect(restarted.dispatch(next.id, nextGrant.id)).rejects.toThrow("fenced");
    expect(await restarted.reconcile(proposal.id)).toMatchObject({ phase: "succeeded" });
    expect(await restarted.dispatch(next.id, nextGrant.id)).toMatchObject({ phase: "succeeded" });
    expect(await readdir(join(f.root, "harmless-receipts"))).toHaveLength(2);
  } finally {
    await f.close();
  }
});
