import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  type EffectOperation,
  type HarmlessPayload,
  harmlessPayloadHash,
  harmlessPayloadSchema,
} from "./harmless-effect-policy";

const receiptSchema = z.strictObject({
  operationId: z.string().uuid(),
  token: z.number().int().positive(),
  payload: harmlessPayloadSchema,
});

/** Owns one bounded, immutable local receipt. Does not send, run commands, or use the network. */
export class HarmlessReceiptAdapter {
  readonly capabilities = {
    durableReceipt: true,
    statusLookup: true,
    idempotency: "exclusive-file",
    cancellation: false,
  };
  constructor(readonly root: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.root, { mode: 0o700 });
  }

  async verifyRoot(): Promise<void> {
    const stat = await lstat(this.root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(this.root)) !== join(await realpath(dirname(this.root)), "harmless-receipts")
    ) {
      throw new Error("Receipt directory is unsafe.");
    }
  }

  async perform(operation: EffectOperation, payload: HarmlessPayload): Promise<string> {
    const bytes = Buffer.from(JSON.stringify({ operationId: operation.id, token: operation.token, payload }));
    const file = await open(
      join(this.root, `${operation.id}.json`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    const directory = await open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return createHash("sha256").update(bytes).digest("hex");
  }

  async lookup(operation: EffectOperation): Promise<string | null> {
    await this.verifyRoot();
    const file = await open(join(this.root, `${operation.id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW).catch(
      (error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (!file) return null;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 4096) return null;
      const bytes = await file.readFile();
      const parsed = receiptSchema.safeParse(JSON.parse(bytes.toString("utf8")));
      if (
        !parsed.success ||
        parsed.data.operationId !== operation.id ||
        parsed.data.token !== operation.token ||
        harmlessPayloadHash(parsed.data.payload) !== operation.payloadHash
      )
        return null;
      return createHash("sha256").update(bytes).digest("hex");
    } catch {
      return null;
    } finally {
      await file.close();
    }
  }
}
