import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** A closed-capability development slice. No user paths, recipients or provider tools. */
export class HarmlessEffectAppService {
  readonly #db: DatabaseSync;
  readonly #root: string;
  readonly #lock: number;
  constructor(root: string) {
    this.#root = root;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.#lock = openSync(
      join(root, "pilot.lock"),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    this.#db = new DatabaseSync(join(root, "effects.sqlite"));
    this.#db.exec(`CREATE TABLE IF NOT EXISTS epoch (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO epoch VALUES(1,0);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, payload TEXT NOT NULL, hash TEXT NOT NULL,
        epoch INTEGER NOT NULL, state TEXT NOT NULL, evidence TEXT, expires INTEGER NOT NULL, receipt TEXT);
      UPDATE operations SET state='unknown' WHERE state='executing';`);
  }
  close(): void {
    this.#db.close();
    closeSync(this.#lock);
    unlinkSync(join(this.#root, "pilot.lock"));
  }
  prepare() {
    const id = randomUUID();
    const payload = JSON.stringify({
      version: 1,
      tool: "harmless.receipt",
      recipient: "local-owner-only",
      scope: "development-pilot",
      text: "Dani-Dex harmless receipt",
      operationId: id,
    });
    const hash = createHash("sha256").update(payload).digest("hex");
    const row = this.#db.prepare("SELECT revision FROM epoch WHERE id=1").get();
    this.#db
      .prepare("INSERT INTO operations (id,payload,hash,epoch,state,expires) VALUES(?,?,?,?, 'prepared',?)")
      .run(id, payload, hash, Number(row?.revision), Date.now() + 300_000);
    return { id, payload, hash };
  }
  review(id: string): string {
    const row = this.#db.prepare("SELECT payload FROM operations WHERE id=?").get(id);
    if (!row || typeof row.payload !== "string") throw new Error("Unknown operation.");
    return row.payload;
  }
  approve(id: string): void {
    const evidence = JSON.stringify({
      issuer: "native-ui-confirmation",
      reviewedPayload: this.review(id),
      acceptedAt: new Date().toISOString(),
      version: 1,
    });
    const result = this.#db
      .prepare("UPDATE operations SET state='approved', evidence=? WHERE id=? AND state='prepared'")
      .run(evidence, id);
    if (result.changes !== 1) throw new Error("Operation is not pending review.");
  }
  revoke(): void {
    this.#db.prepare("UPDATE epoch SET revision=revision+1 WHERE id=1").run();
  }
  async dispatch(
    id: string,
    beforeDispatch?: () => Promise<void>,
    loseResponse = false,
  ): Promise<"succeeded" | "unknown"> {
    await beforeDispatch?.();
    // This transaction is the local linearization point; no await before the fixed receipt write.
    this.#db.exec("BEGIN IMMEDIATE");
    let payload: string;
    try {
      const row = this.#db.prepare("SELECT * FROM operations WHERE id=?").get(id);
      const epoch = this.#db.prepare("SELECT revision FROM epoch WHERE id=1").get();
      if (
        row?.state !== "approved" ||
        !row.evidence ||
        row.epoch !== epoch?.revision ||
        Number(row.expires) <= Date.now() ||
        typeof row.payload !== "string" ||
        createHash("sha256").update(row.payload).digest("hex") !== row.hash
      )
        throw new Error("Dispatch denied.");
      if (this.#db.prepare("SELECT id FROM operations WHERE state IN ('executing','unknown')").get())
        throw new Error("Unresolved effect holds the receipt fence.");
      payload = row.payload;
      this.#db.prepare("UPDATE operations SET state='executing' WHERE id=?").run(id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    try {
      // Exclusive, non-following file creation. Journal IDs are generated here, never model paths.
      const fd = openSync(
        join(this.#root, `${id}.receipt`),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, payload);
      } finally {
        closeSync(fd);
      }
      if (loseResponse) throw new Error("Injected response loss.");
      this.#db.prepare("UPDATE operations SET state='succeeded', receipt=? WHERE id=?").run(id, id);
      return "succeeded";
    } catch {
      this.#db.prepare("UPDATE operations SET state='unknown' WHERE id=?").run(id);
      return "unknown";
    }
  }
  reconcile(id: string): string {
    const row = this.#db.prepare("SELECT payload,state FROM operations WHERE id=?").get(id);
    if (row?.state !== "unknown") throw new Error("Operation is not unknown.");
    // No resend. Exact fixed receipt bytes prove this harmless local adapter's accepted effect.
    const fd = openSync(join(this.#root, `${id}.receipt`), constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: string;
    try {
      bytes = readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
    if (bytes !== row.payload) throw new Error("Receipt does not match intent.");
    this.#db.prepare("UPDATE operations SET state='succeeded',receipt=? WHERE id=?").run(id, id);
    return "succeeded";
  }
  snapshot() {
    return this.#db.prepare("SELECT id,state,hash,evidence,receipt FROM operations ORDER BY rowid").all();
  }
}
