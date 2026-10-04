import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DaniDexDatabase } from "../dani-dex-database";
import { HarmlessEffectJournal } from "./harmless-effect-journal";
import { type ApprovalEvidence, EffectDeniedError, type EffectOperation } from "./harmless-effect-policy";
import { HarmlessReceiptAdapter } from "./harmless-receipt-adapter";

/** Owns the fixed pilot adapter. Native main-process code holds this capability; providers do not. */
export class HarmlessEffectExecutor {
  readonly journal: HarmlessEffectJournal;
  readonly adapter: HarmlessReceiptAdapter;
  readonly #holder = randomUUID();

  constructor(
    database: DaniDexDatabase,
    readonly owner: string,
    now: () => number,
  ) {
    this.journal = new HarmlessEffectJournal(database, owner, now);
    this.adapter = new HarmlessReceiptAdapter(join(database.userDataPath, "harmless-receipts"));
  }

  async initialize(): Promise<void> {
    await this.adapter.initialize().catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    });
    await this.adapter.verifyRoot();
  }

  propose(dependencyIds: readonly string[] = []) {
    return this.journal.propose(dependencyIds);
  }
  proposal(id: string, owner: string) {
    return this.journal.proposal(id, owner);
  }
  approve(id: string, evidence: ApprovalEvidence) {
    return this.journal.approve(id, evidence);
  }
  cancel(): void {
    this.journal.changeEpoch("cancelEpoch");
  }
  revoke(): void {
    this.journal.changeEpoch("revocationEpoch");
  }
  membershipChanged(): void {
    this.journal.changeEpoch("membershipVersion");
  }

  async dispatch(id: string, grantId: string): Promise<EffectOperation> {
    await this.adapter.verifyRoot();
    // No await between the final stored-context check, committed intent, and invoking the fixed adapter.
    const operation = this.journal.claim(id, grantId, this.#holder);
    const payload = this.proposal(id, this.owner).payload;
    try {
      const receipt = await this.adapter.perform(operation, payload);
      return this.journal.finish(operation, "succeeded", receipt);
    } catch {
      return this.journal.finish(operation, "unknown", null);
    }
  }

  async reconcile(id: string): Promise<EffectOperation> {
    const operation = this.journal.operation(id);
    if (!operation) throw new EffectDeniedError();
    if (operation.phase === "succeeded") return operation;
    // Never resends. A missing or incomplete receipt cannot prove that no effect happened.
    const receipt = await this.adapter.lookup(operation);
    return this.journal.finish(operation, receipt ? "succeeded" : "unknown", receipt);
  }
}
