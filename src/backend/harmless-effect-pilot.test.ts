import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { HarmlessEffectPilot, type PilotContext, type PilotGrant, pilotPayloadHash } from "./harmless-effect-pilot";

it("denies payload/membership/child-scope changes and writes one independent approved receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "dani-effects-"));
  const pilot = new HarmlessEffectPilot(join(root, "journal.sqlite"));
  const payload = { recipient: "owner", attachmentSha256: "original-bytes-hash", text: "harmless" };
  const context: PilotContext = {
    actor: "chief",
    scope: "local-owner",
    membershipVersion: 1,
    revocationEpoch: 0,
    cancelEpoch: 0,
  };
  const grant: PilotGrant = {
    version: 1,
    id: "approval-1",
    issuer: "local-owner",
    approvalEvidence: "test-only-owner-evidence",
    actor: "chief",
    tool: "harmless.receipt",
    resource: "receipt-file",
    scope: "local-owner",
    payloadHash: pilotPayloadHash(payload),
    membershipVersion: 1,
    revocationEpoch: 0,
    cancelEpoch: 0,
    expiresAt: 100,
    oneShot: true,
  };
  let effects = 0;
  const input = {
    id: "operation",
    grant,
    resource: "receipt-file",
    payload,
    initialCancelEpoch: 0,
    context: () => context,
    now: () => 1,
    effect: async () => {
      effects++;
      await writeFile(join(root, "receipt.txt"), "external-effect-1");
      return "external-effect-1";
    },
  };
  try {
    await expect(pilot.dispatch({ ...input, payload: { ...payload, recipient: "outsider" } })).rejects.toThrow(
      "denied",
    );
    await expect(
      pilot.dispatch({ ...input, payload: { ...payload, attachmentSha256: "changed-bytes" } }),
    ).rejects.toThrow("denied");
    context.membershipVersion = 2;
    await expect(pilot.dispatch(input)).rejects.toThrow("denied");
    context.membershipVersion = 1;
    await expect(pilot.dispatch({ ...input, grant: { ...grant, scope: "wider-child-scope" } })).rejects.toThrow(
      "denied",
    );
    expect(effects).toBe(0);
    expect(await pilot.dispatch(input)).toBe("succeeded");
    expect(await readFile(join(root, "receipt.txt"), "utf8")).toBe("external-effect-1");
    await expect(pilot.dispatch({ ...input, id: "another-op" })).rejects.toThrow();
    expect(effects).toBe(1);
  } finally {
    pilot.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("revocation and cancel at the dispatch barrier cause zero effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "dani-effects-"));
  const pilot = new HarmlessEffectPilot(join(root, "journal.sqlite"));
  let effects = 0;
  const payload = { recipient: "owner", attachmentSha256: "none", text: "test" };
  const context = { actor: "chief", scope: "owner", membershipVersion: 1, revocationEpoch: 0, cancelEpoch: 0 };
  const grant: PilotGrant = {
    version: 1,
    id: "g",
    issuer: "local-owner",
    approvalEvidence: "fixture",
    actor: "chief",
    tool: "harmless.receipt",
    resource: "r",
    scope: "owner",
    payloadHash: pilotPayloadHash(payload),
    membershipVersion: 1,
    revocationEpoch: 0,
    cancelEpoch: 0,
    expiresAt: 100,
    oneShot: true,
  };
  const input = {
    id: "i",
    grant,
    resource: "r",
    payload,
    initialCancelEpoch: 0,
    context: () => context,
    now: () => 1,
    effect: async () => {
      effects++;
      await writeFile(join(root, "receipt.txt"), "receipt");
      return "receipt";
    },
  };
  try {
    await expect(
      pilot.dispatch({
        ...input,
        beforeDispatch: async () => {
          context.revocationEpoch++;
        },
      }),
    ).rejects.toThrow("denied");
    context.revocationEpoch = 0;
    await expect(
      pilot.dispatch({
        ...input,
        beforeDispatch: async () => {
          context.cancelEpoch++;
        },
      }),
    ).rejects.toThrow("denied");
    await expect(pilot.dispatch({ ...input, initialCancelEpoch: context.cancelEpoch })).rejects.toThrow("denied");
    expect(pilot.state(input.id)).toBeNull();
    await expect(access(join(root, "receipt.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(effects).toBe(0);
  } finally {
    pilot.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("accepted-but-response-lost stays unknown after restart and cannot retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "dani-effects-"));
  let pilot = new HarmlessEffectPilot(join(root, "journal.sqlite"));
  const payload = { recipient: "owner", attachmentSha256: "none", text: "test" };
  const grant: PilotGrant = {
    version: 1,
    id: "g",
    issuer: "local-owner",
    approvalEvidence: "fixture",
    actor: "chief",
    tool: "harmless.receipt",
    resource: "r",
    scope: "owner",
    payloadHash: pilotPayloadHash(payload),
    membershipVersion: 1,
    revocationEpoch: 0,
    cancelEpoch: 0,
    expiresAt: 100,
    oneShot: true,
  };
  let effects = 0;
  const input = {
    id: "i",
    grant,
    resource: "r",
    payload,
    initialCancelEpoch: 0,
    context: () => ({ actor: "chief", scope: "owner", membershipVersion: 1, revocationEpoch: 0, cancelEpoch: 0 }),
    now: () => 1,
    effect: async () => {
      effects++;
      await writeFile(join(root, "receipt.txt"), "accepted");
      throw new Error("response lost");
    },
  };
  try {
    expect(await pilot.dispatch(input)).toBe("unknown");
    pilot.close();
    pilot = new HarmlessEffectPilot(join(root, "journal.sqlite"));
    expect(pilot.state("i")).toBe("unknown");
    await expect(pilot.dispatch(input)).rejects.toThrow("reconciliation");
    expect(effects).toBe(1);
    expect(await readFile(join(root, "receipt.txt"), "utf8")).toBe("accepted");
  } finally {
    pilot.close();
    await rm(root, { recursive: true, force: true });
  }
});
