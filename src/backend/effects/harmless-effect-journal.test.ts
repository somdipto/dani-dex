import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { DaniDexDatabase } from "../dani-dex-database";
import { HarmlessEffectExecutor } from "./harmless-effect-executor";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dani-effect-boundary-"));
  const database = new DaniDexDatabase(root);
  await database.initialize();
  let now = 1000;
  const executor = new HarmlessEffectExecutor(database, "uid:501", () => now);
  await executor.initialize();
  const approve = (id: string) => executor.approve(id, { issuer: "uid:501", source: "native-dialog", approvedAt: now });
  return {
    root,
    database,
    executor,
    approve,
    advance: () => {
      now += 60_000;
    },
    close: async () => {
      database.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it.each(["cancel", "revoke", "membershipChanged"] as const)(
  "%s at the final barrier causes zero effects",
  async (action) => {
    const f = await fixture();
    try {
      const proposal = f.executor.propose();
      const grant = f.approve(proposal.id);
      const verify = f.executor.adapter.verifyRoot.bind(f.executor.adapter);
      vi.spyOn(f.executor.adapter, "verifyRoot").mockImplementationOnce(async () => {
        await verify();
        f.executor[action]();
      });
      await expect(f.executor.dispatch(proposal.id, grant.id)).rejects.toThrow("denied");
      expect(await readdir(join(f.root, "harmless-receipts"))).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

it("rolls back one-shot consumption if persisted intent fails", async () => {
  const f = await fixture();
  try {
    const proposal = f.executor.propose();
    const grant = f.approve(proposal.id);
    f.database.connection.exec(`CREATE TRIGGER fail_intent BEFORE INSERT ON orchestration_events
      WHEN NEW.aggregate_type = 'harmless-effect-v1:operation' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;`);
    await expect(f.executor.dispatch(proposal.id, grant.id)).rejects.toThrow("injected write failure");
    expect(f.executor.journal.operation(proposal.id)).toBeNull();
    expect(await readdir(join(f.root, "harmless-receipts"))).toEqual([]);
    f.database.connection.exec("DROP TRIGGER fail_intent");
    expect(await f.executor.dispatch(proposal.id, grant.id)).toMatchObject({ phase: "succeeded" });
  } finally {
    await f.close();
  }
});

it("a committed intent stays fenced after restart and lease expiry with no receipt", async () => {
  const f = await fixture();
  try {
    const proposal = f.executor.propose();
    const grant = f.approve(proposal.id);
    f.executor.journal.claim(proposal.id, grant.id, "6fca103c-f959-4360-9ef2-3412c95d6e14");
    f.database.close();
    await f.database.initialize();
    f.advance();
    const next = f.executor.propose();
    const nextGrant = f.approve(next.id);
    await expect(f.executor.dispatch(next.id, nextGrant.id)).rejects.toThrow("fenced");
    expect(await f.executor.reconcile(proposal.id)).toMatchObject({ phase: "unknown", receipt: null });
    await expect(f.executor.dispatch(next.id, nextGrant.id)).rejects.toThrow("fenced");
    expect(await readdir(join(f.root, "harmless-receipts"))).toEqual([]);
  } finally {
    await f.close();
  }
});

it("reconciles a file accepted before a failed result commit without another effect", async () => {
  const f = await fixture();
  try {
    const proposal = f.executor.propose();
    const grant = f.approve(proposal.id);
    f.database.connection.exec(`CREATE TRIGGER fail_result BEFORE INSERT ON orchestration_events
      WHEN NEW.aggregate_type = 'harmless-effect-v1:operation' AND json_extract(NEW.payload_json, '$.phase') != 'executing'
      BEGIN SELECT RAISE(ABORT, 'injected result failure'); END;`);
    await expect(f.executor.dispatch(proposal.id, grant.id)).rejects.toThrow("injected result failure");
    expect(f.executor.journal.operation(proposal.id)).toMatchObject({ phase: "executing" });
    f.database.connection.exec("DROP TRIGGER fail_result");
    f.database.close();
    await f.database.initialize();
    expect(await f.executor.reconcile(proposal.id)).toMatchObject({ phase: "succeeded" });
    expect(await readdir(join(f.root, "harmless-receipts"))).toEqual([`${proposal.id}.json`]);
  } finally {
    await f.close();
  }
});

it("serializes a resource across two database connections with increasing fence tokens", async () => {
  const f = await fixture();
  const secondDb = new DaniDexDatabase(f.root);
  await secondDb.initialize();
  try {
    const second = new HarmlessEffectExecutor(secondDb, "uid:501", () => 1000);
    await second.initialize();
    const first = f.executor.propose();
    const firstGrant = f.approve(first.id);
    const next = second.propose();
    const nextGrant = second.approve(next.id, { issuer: "uid:501", source: "native-dialog", approvedAt: 1000 });
    const reached = deferred();
    const release = deferred();
    const perform = f.executor.adapter.perform.bind(f.executor.adapter);
    vi.spyOn(f.executor.adapter, "perform").mockImplementationOnce(async (operation, payload) => {
      const receipt = await perform(operation, payload);
      reached.resolve();
      await release.promise;
      return receipt;
    });
    const dispatched = f.executor.dispatch(first.id, firstGrant.id);
    await reached.promise;
    await expect(second.dispatch(next.id, nextGrant.id)).rejects.toThrow("fenced");
    release.resolve();
    const result = await dispatched;
    const nextResult = await second.dispatch(next.id, nextGrant.id);
    expect(nextResult.token).toBeGreaterThan(result.token);
    expect(await readdir(join(f.root, "harmless-receipts"))).toHaveLength(2);
  } finally {
    secondDb.close();
    await f.close();
  }
});

it("requires a verified dependency before a second effect", async () => {
  const f = await fixture();
  try {
    const first = f.executor.propose();
    const next = f.executor.propose([first.id]);
    const nextGrant = f.approve(next.id);
    await expect(f.executor.dispatch(next.id, nextGrant.id)).rejects.toThrow("dependency");
    expect(await readdir(join(f.root, "harmless-receipts"))).toEqual([]);
    await f.executor.dispatch(first.id, f.approve(first.id).id);
    expect(await f.executor.dispatch(next.id, nextGrant.id)).toMatchObject({ phase: "succeeded" });
  } finally {
    await f.close();
  }
});

it("refuses a symlink receipt directory without writing outside the profile", async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "dani-effect-outside-"));
  try {
    const proposal = f.executor.propose();
    const grant = f.approve(proposal.id);
    await rm(join(f.root, "harmless-receipts"), { recursive: true });
    await symlink(outside, join(f.root, "harmless-receipts"));
    await expect(f.executor.dispatch(proposal.id, grant.id)).rejects.toThrow("unsafe");
    expect(await readdir(outside)).toEqual([]);
  } finally {
    await f.close();
    await rm(outside, { recursive: true, force: true });
  }
});
