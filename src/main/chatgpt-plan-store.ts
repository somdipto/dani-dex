import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { SecretCipher } from "./provider-credential-store";

const registrationSchema = z.object({
  clientId: z.string().min(1),
  subject: z.string().min(1),
  email: z.string().nullable(),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1),
  scopes: z.array(z.string()),
  expiresAt: z.number().int().positive(),
  earliestRefreshAt: z.number().int().nonnegative().optional(),
});
export type ChatGptRegistration = z.infer<typeof registrationSchema>;
const stateSchema = z.object({
  version: z.literal(1),
  hostId: z.string().uuid(),
  registrations: z.array(registrationSchema).max(32),
  selectedClientId: z.string().nullable().optional(),
});
type State = z.infer<typeof stateSchema>;
const envelopeSchema = z.object({
  version: z.literal(1),
  ciphertext: z
    .string()
    .min(1)
    .max(1024 * 1024),
});

/** Separate from provider-owned OAuth files. An unreadable store is never replaced as empty. */
export class ChatGptPlanStore {
  #state: State | null = null;
  #pending: Promise<void> = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly cipher: SecretCipher,
  ) {}
  async load(): Promise<void> {
    await this.#enqueue(async () => {
      let bytes: Buffer;
      try {
        bytes = await readFile(this.path);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
          throw new Error("ChatGPT sign-in storage is unreadable.");
        await this.#commit({ version: 1, hostId: randomUUID(), registrations: [] });
        return;
      }
      try {
        if (bytes.length > 1024 * 1024) throw new Error();
        const envelope = envelopeSchema.parse(JSON.parse(bytes.toString("utf8")));
        const state = stateSchema.parse(JSON.parse(this.cipher.decrypt(Buffer.from(envelope.ciphertext, "base64"))));
        if (new Set(state.registrations.map((r) => r.clientId)).size !== state.registrations.length) throw new Error();
        this.#state = state;
      } catch {
        throw new Error("ChatGPT sign-in storage is unreadable. Existing registrations were kept.");
      }
    });
  }
  hostId(): string {
    return this.#loaded().hostId;
  }
  list(): ChatGptRegistration[] {
    return structuredClone(this.#loaded().registrations);
  }
  read(clientId: string): ChatGptRegistration | null {
    return this.list().find((r) => r.clientId === clientId) ?? null;
  }
  selected(): ChatGptRegistration | null {
    const state = this.#loaded();
    return state.selectedClientId ? this.read(state.selectedClientId) : null;
  }
  select(clientId: string): Promise<void> {
    return this.#enqueue(async () => {
      if (!this.read(clientId)) throw new Error("ChatGPT registration is unavailable.");
      await this.#commit({ ...this.#loaded(), selectedClientId: clientId });
    });
  }
  save(value: ChatGptRegistration): Promise<void> {
    return this.#enqueue(async () => {
      const state = this.#loaded();
      const registration = registrationSchema.parse(value);
      if (registration.clientId === "dynamic_agent_client") throw new Error("An issued ChatGPT client ID is required.");
      const old = state.registrations.find((r) => r.clientId === registration.clientId);
      if (old && old.subject !== registration.subject) throw new Error("ChatGPT registration identity changed.");
      await this.#commit({
        ...state,
        registrations: [...state.registrations.filter((r) => r.clientId !== registration.clientId), registration],
      });
    });
  }
  remove(clientId: string): Promise<void> {
    return this.#enqueue(async () => {
      const state = this.#loaded();
      await this.#commit({
        ...state,
        selectedClientId: state.selectedClientId === clientId ? null : state.selectedClientId,
        registrations: state.registrations.filter((r) => r.clientId !== clientId),
      });
    });
  }
  #loaded(): State {
    if (!this.#state)
      throw new Error(
        "ChatGPT sign-in storage is locked. Open Dani-Dex on your Mac and unlock Keychain, then try ChatGPT again.",
      );
    return this.#state;
  }
  #enqueue(run: () => Promise<void>): Promise<void> {
    const result = this.#pending.then(run);
    this.#pending = result.catch(() => undefined);
    return result;
  }
  async #commit(value: State): Promise<void> {
    const state = stateSchema.parse(value);
    // The injected OS cipher must fail closed. No plaintext fallback or partial rotation.
    const encrypted = this.cipher.encrypt(JSON.stringify(state));
    const temp = `${this.path}.${randomUUID()}.tmp`;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temp, JSON.stringify({ version: 1, ciphertext: encrypted.toString("base64") }), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, this.path);
    } finally {
      await rm(temp, { force: true });
    }
    this.#state = state;
  }
}
