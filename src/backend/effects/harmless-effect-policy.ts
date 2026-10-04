import { createHash } from "node:crypto";
import { z } from "zod";

const ownerId = z.string().regex(/^uid:\d+$/u);
const epoch = z.number().int().nonnegative();
export const harmlessPayloadSchema = z.strictObject({
  version: z.literal(1),
  tool: z.literal("harmless.receipt"),
  actor: z.literal("chief-of-staff"),
  scope: ownerId,
  recipient: ownerId,
  audience: z.tuple([ownerId]),
  destination: z.string().uuid(),
  deliveryTime: z.number().int().nonnegative(),
  attachmentBase64: z.literal("aGFybWxlc3M="),
  text: z.literal("Dani-Dex harmless receipt."),
  total: z.null(),
  currency: z.null(),
});
export type HarmlessPayload = z.infer<typeof harmlessPayloadSchema>;
export const effectContextSchema = z.strictObject({
  scope: ownerId,
  audience: z.tuple([ownerId]),
  membershipVersion: epoch,
  revocationEpoch: epoch,
  cancelEpoch: epoch,
});
export type EffectContext = z.infer<typeof effectContextSchema>;
export const proposalSchema = z.strictObject({
  id: z.string().uuid(),
  payload: harmlessPayloadSchema,
  context: effectContextSchema,
  dependencyIds: z.array(z.string().uuid()).max(8),
  expiresAt: z.number().int().nonnegative(),
});
export type EffectProposal = z.infer<typeof proposalSchema>;
export const approvalEvidenceSchema = z.strictObject({
  issuer: ownerId,
  source: z.literal("native-dialog"),
  approvedAt: z.number().int().nonnegative(),
});
export type ApprovalEvidence = z.infer<typeof approvalEvidenceSchema>;
export const grantSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().uuid(),
  proposal: proposalSchema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  evidence: approvalEvidenceSchema,
  oneShot: z.literal(true),
  consumed: z.boolean(),
});
export type StoredEffectGrant = z.infer<typeof grantSchema>;
export const operationSchema = z.strictObject({
  id: z.string().uuid(),
  scope: ownerId,
  resource: z.literal("harmless-receipts"),
  grantId: z.string().uuid(),
  holder: z.string().uuid(),
  token: z.number().int().positive(),
  leaseExpiresAt: z.number().int().nonnegative(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  phase: z.enum(["executing", "succeeded", "unknown"]),
  receipt: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
});
export type EffectOperation = z.infer<typeof operationSchema>;

export class EffectDeniedError extends Error {
  readonly name = "EffectDeniedError";
  constructor(message = "Effect denied.") {
    super(message);
  }
}

export function harmlessPayloadHash(payload: HarmlessPayload): string {
  return createHash("sha256")
    .update(JSON.stringify(harmlessPayloadSchema.parse(payload)))
    .digest("hex");
}

export function sameEffectContext(left: EffectContext, right: EffectContext): boolean {
  return JSON.stringify(effectContextSchema.parse(left)) === JSON.stringify(effectContextSchema.parse(right));
}
