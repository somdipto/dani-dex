import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { DaniDexDatabase } from "../dani-dex-database";
import { databaseRow, requiredStringColumn } from "../database/database-rows";
import {
  type ApprovalEvidence,
  approvalEvidenceSchema,
  type EffectContext,
  EffectDeniedError,
  type EffectOperation,
  type EffectProposal,
  effectContextSchema,
  grantSchema,
  harmlessPayloadHash,
  operationSchema,
  proposalSchema,
  type StoredEffectGrant,
  sameEffectContext,
} from "./harmless-effect-policy";

/** Owns pilot grants and fences in the existing event log. No second database or scheduler. */
export class HarmlessEffectJournal {
  constructor(
    readonly database: DaniDexDatabase,
    readonly owner: string,
    readonly now: () => number,
  ) {}

  context(): EffectContext {
    return (
      this.#read("context", this.owner, effectContextSchema) ??
      effectContextSchema.parse({
        scope: this.owner,
        audience: [this.owner],
        membershipVersion: 1,
        revocationEpoch: 0,
        cancelEpoch: 0,
      })
    );
  }

  changeEpoch(kind: "cancelEpoch" | "revocationEpoch" | "membershipVersion"): void {
    this.#atomic(() => {
      const current = this.context();
      this.#append("context", this.owner, { ...current, [kind]: current[kind] + 1 });
    });
  }

  propose(dependencyIds: readonly string[] = []): EffectProposal {
    return this.#atomic(() => {
      const id = randomUUID();
      const proposal = proposalSchema.parse({
        id,
        payload: {
          version: 1,
          tool: "harmless.receipt",
          actor: "chief-of-staff",
          scope: this.owner,
          recipient: this.owner,
          audience: [this.owner],
          destination: id,
          deliveryTime: this.now(),
          attachmentBase64: "aGFybWxlc3M=",
          text: "Dani-Dex harmless receipt.",
          total: null,
          currency: null,
        },
        context: this.context(),
        dependencyIds: [...dependencyIds],
        expiresAt: this.now() + 300_000,
      });
      this.#append("proposal", id, proposal);
      return proposal;
    });
  }

  proposal(id: string, owner: string): EffectProposal {
    const proposal = this.#read("proposal", id, proposalSchema);
    if (!proposal || owner !== this.owner || proposal.payload.scope !== owner) throw new EffectDeniedError();
    return proposal;
  }

  /** Called only by the main-process native approval callback. Never accepts model/IPC grant JSON. */
  approve(id: string, evidence: ApprovalEvidence): StoredEffectGrant {
    return this.#atomic(() => {
      const proposal = this.proposal(id, this.owner);
      const parsed = approvalEvidenceSchema.parse(evidence);
      const now = this.now();
      if (
        parsed.issuer !== this.owner ||
        parsed.approvedAt > now ||
        parsed.approvedAt < proposal.payload.deliveryTime ||
        proposal.expiresAt <= this.now() ||
        !sameEffectContext(proposal.context, this.context())
      ) {
        throw new EffectDeniedError();
      }
      const grant = grantSchema.parse({
        version: 1,
        id: randomUUID(),
        proposal,
        payloadHash: harmlessPayloadHash(proposal.payload),
        evidence: parsed,
        oneShot: true,
        consumed: false,
      });
      this.#append("grant", grant.id, grant);
      return grant;
    });
  }

  claim(id: string, grantId: string, holder: string): EffectOperation {
    return this.#atomic(() => {
      const proposal = this.proposal(id, this.owner);
      const grant = this.#read("grant", grantId, grantSchema);
      const context = this.context();
      if (
        !grant ||
        grant.consumed ||
        grant.evidence.issuer !== this.owner ||
        grant.proposal.id !== id ||
        JSON.stringify(grant.proposal) !== JSON.stringify(proposal) ||
        grant.proposal.expiresAt <= this.now() ||
        !sameEffectContext(grant.proposal.context, context) ||
        !sameEffectContext(proposal.context, context) ||
        grant.payloadHash !== harmlessPayloadHash(proposal.payload) ||
        proposal.payload.recipient !== this.owner ||
        proposal.payload.audience[0] !== this.owner ||
        this.operation(id)
      ) {
        throw new EffectDeniedError();
      }
      if (proposal.dependencyIds.some((dependencyId) => this.operation(dependencyId)?.phase !== "succeeded")) {
        throw new EffectDeniedError("Effect denied until its dependency has a verified receipt.");
      }
      const unresolved = this.database.connection
        .prepare(`
        SELECT e.payload_json FROM orchestration_events e
        JOIN (SELECT aggregate_id, MAX(sequence) AS seq FROM orchestration_events
          WHERE aggregate_type = 'harmless-effect-v1:operation' GROUP BY aggregate_id) latest
        ON e.sequence = latest.seq
        WHERE json_extract(e.payload_json, '$.scope') = ?
          AND json_extract(e.payload_json, '$.resource') = 'harmless-receipts'
          AND json_extract(e.payload_json, '$.phase') IN ('executing', 'unknown') LIMIT 1
      `)
        .get(this.owner);
      if (unresolved) throw new EffectDeniedError("Resource is fenced by an unresolved effect.");
      const token = this.#append("grant", grant.id, { ...grant, consumed: true });
      const operation = operationSchema.parse({
        id,
        scope: this.owner,
        resource: "harmless-receipts",
        grantId,
        holder,
        token,
        leaseExpiresAt: this.now() + 30_000,
        payloadHash: grant.payloadHash,
        phase: "executing",
        receipt: null,
      });
      this.#append("operation", id, operation);
      return operation;
    });
  }

  operation(id: string): EffectOperation | null {
    const operation = this.#read("operation", id, operationSchema);
    if (operation && operation.scope !== this.owner) throw new EffectDeniedError();
    return operation;
  }

  finish(operation: EffectOperation, phase: "succeeded" | "unknown", receipt: string | null): EffectOperation {
    return this.#atomic(() => {
      const current = this.operation(operation.id);
      if (
        !current ||
        current.holder !== operation.holder ||
        current.token !== operation.token ||
        current.phase === "succeeded"
      )
        throw new EffectDeniedError();
      const result = operationSchema.parse({ ...current, phase, receipt });
      this.#append("operation", operation.id, result);
      return result;
    });
  }

  snapshot(): EffectOperation[] {
    const rows = this.database.connection
      .prepare(`SELECT e.payload_json FROM orchestration_events e
      JOIN (SELECT aggregate_id, MAX(sequence) AS seq FROM orchestration_events
        WHERE aggregate_type = 'harmless-effect-v1:operation' GROUP BY aggregate_id) latest
      ON e.sequence = latest.seq WHERE json_extract(e.payload_json, '$.scope') = ? ORDER BY e.sequence`)
      .all(this.owner);
    return rows.map((row) => operationSchema.parse(JSON.parse(requiredStringColumn(row, "payload_json"))));
  }

  #read<T>(kind: string, id: string, schema: z.ZodType<T>): T | null {
    const row = databaseRow(
      this.database.connection
        .prepare(`SELECT payload_json FROM orchestration_events
      WHERE aggregate_type = ? AND aggregate_id = ? ORDER BY sequence DESC LIMIT 1`)
        .get(`harmless-effect-v1:${kind}`, id),
    );
    return row ? schema.parse(JSON.parse(requiredStringColumn(row, "payload_json"))) : null;
  }

  #append(
    kind: string,
    id: string,
    payload: EffectContext | EffectProposal | StoredEffectGrant | EffectOperation,
  ): number {
    return this.database.dispatch(
      randomUUID(),
      [
        {
          aggregateType: `harmless-effect-v1:${kind}`,
          aggregateId: id,
          eventType: `harmless-effect.${kind}`,
          payload,
        },
      ],
      (_db, sequences) => {
        const sequence = sequences[0];
        if (sequence === undefined) throw new EffectDeniedError();
        return sequence;
      },
    );
  }

  #atomic<T>(change: () => T): T {
    if (this.database.connection.isTransaction)
      throw new EffectDeniedError("Effect denied inside an open transaction.");
    return this.database.dispatch(randomUUID(), [], change);
  }
}
