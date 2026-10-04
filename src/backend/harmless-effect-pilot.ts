import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface PilotPayload {
  recipient: string;
  attachmentSha256: string;
  text: string;
}
export interface PilotGrant {
  version: 1;
  id: string;
  issuer: "local-owner";
  approvalEvidence: string;
  actor: string;
  tool: "harmless.receipt";
  resource: string;
  scope: string;
  payloadHash: string;
  membershipVersion: number;
  revocationEpoch: number;
  readonly cancelEpoch: number;
  expiresAt: number;
  oneShot: true;
}
export interface PilotContext {
  actor: string;
  scope: string;
  membershipVersion: number;
  revocationEpoch: number;
  cancelEpoch: number;
}
export function pilotPayloadHash(payload: PilotPayload): string {
  return createHash("sha256")
    .update(JSON.stringify([payload.recipient, payload.attachmentSha256, payload.text]))
    .digest("hex");
}

/** Isolated harmless-effect prototype, not a security boundary for provider-native tools. */
export class HarmlessEffectPilot {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS effects (
      id TEXT PRIMARY KEY, grant_id TEXT UNIQUE NOT NULL, resource TEXT NOT NULL,
      payload_hash TEXT NOT NULL, state TEXT NOT NULL, receipt TEXT);
      UPDATE effects SET state='unknown' WHERE state='executing';`);
  }
  close(): void {
    this.db.close();
  }
  state(id: string): string | null {
    const row = this.db.prepare("SELECT state FROM effects WHERE id=?").get(id);
    return row && typeof row.state === "string" ? row.state : null;
  }
  async dispatch(input: {
    id: string;
    grant: PilotGrant;
    resource: string;
    payload: PilotPayload;
    initialCancelEpoch: number;
    context(): PilotContext;
    now(): number;
    beforeDispatch?(): Promise<void>;
    effect(): Promise<string>;
  }): Promise<"succeeded" | "unknown"> {
    if (this.state(input.id)) throw new Error("Existing operation requires reconciliation, not redispatch.");
    await input.beforeDispatch?.();
    // No await between the final check, persisted intent and invoking the adapter.
    // A single process owns this prototype; cross-process leases are not implemented.
    const context = input.context();
    const grant = input.grant;
    if (
      grant.version !== 1 ||
      grant.issuer !== "local-owner" ||
      !grant.approvalEvidence ||
      grant.tool !== "harmless.receipt" ||
      grant.actor !== context.actor ||
      grant.scope !== context.scope ||
      grant.resource !== input.resource ||
      grant.payloadHash !== pilotPayloadHash(input.payload) ||
      grant.membershipVersion !== context.membershipVersion ||
      grant.revocationEpoch !== context.revocationEpoch ||
      grant.cancelEpoch !== context.cancelEpoch ||
      context.cancelEpoch !== input.initialCancelEpoch ||
      grant.expiresAt <= input.now() ||
      grant.oneShot !== true
    )
      throw new Error("Dispatch denied.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        this.db
          .prepare("SELECT id FROM effects WHERE resource=? AND state IN ('executing','unknown')")
          .get(input.resource)
      ) {
        throw new Error("Resource is fenced by an unresolved effect.");
      }
      this.db
        .prepare("INSERT INTO effects (id,grant_id,resource,payload_hash,state) VALUES (?,?,?,?, 'executing')")
        .run(input.id, grant.id, input.resource, grant.payloadHash);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    try {
      const receipt = await input.effect();
      if (!receipt) throw new Error("Missing receipt.");
      this.db.prepare("UPDATE effects SET state='succeeded', receipt=? WHERE id=?").run(receipt, input.id);
      return "succeeded";
    } catch {
      this.db.prepare("UPDATE effects SET state='unknown' WHERE id=?").run(input.id);
      return "unknown";
    }
  }
}
