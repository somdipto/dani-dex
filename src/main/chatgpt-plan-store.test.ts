import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatGptPlanStore, type ChatGptRegistration } from "./chatgpt-plan-store";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((h) => rm(h, { recursive: true, force: true })));
});
const cipher = {
  encrypt: (s: string) => Buffer.from(Buffer.from(s).map((b) => b ^ 0x55)),
  decrypt: (b: Buffer) =>
    Buffer.from(b)
      .map((n) => n ^ 0x55)
      .toString(),
};
const record: ChatGptRegistration = {
  clientId: "issued-1",
  subject: "subject-1",
  email: "test@example.com",
  accessToken: "private-access",
  refreshToken: "private-refresh",
  idToken: "private-id",
  scopes: ["openid"],
  expiresAt: 1900000000,
};
async function fixture() {
  const h = await mkdtemp(join(tmpdir(), "dani-oauth-store-"));
  homes.push(h);
  return join(h, "accounts.json");
}
describe("ChatGPT protected registrations", () => {
  it("persists stable host identity and ciphertext across restart", async () => {
    const path = await fixture(),
      store = new ChatGptPlanStore(path, cipher);
    await store.load();
    const host = store.hostId();
    await store.save(record);
    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("private-access");
    expect(raw).not.toContain("test@example.com");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const next = new ChatGptPlanStore(path, cipher);
    await next.load();
    expect(next.hostId()).toBe(host);
    expect(next.read("issued-1")).toEqual(record);
    await store.select("issued-1");
    const restarted = new ChatGptPlanStore(path, cipher);
    await restarted.load();
    expect(restarted.selected()).toEqual(record);
  });
  it("serializes concurrent updates and removes only the selected registration", async () => {
    const store = new ChatGptPlanStore(await fixture(), cipher);
    await store.load();
    await Promise.all([store.save(record), store.save({ ...record, clientId: "issued-2", subject: "subject-2" })]);
    expect(store.list()).toHaveLength(2);
    await expect(store.save({ ...record, subject: "different" })).rejects.toThrow("identity");
    await store.select("issued-2");
    await store.remove("issued-1");
    expect(store.selected()?.clientId).toBe("issued-2");
    expect(store.list().map((r) => r.clientId)).toEqual(["issued-2"]);
  });
  it("keeps unreadable storage instead of overwriting unrelated credentials", async () => {
    const path = await fixture();
    await writeFile(path, "old-unreadable");
    const store = new ChatGptPlanStore(path, cipher);
    await expect(store.load()).rejects.toThrow("kept");
    await expect(store.save(record)).rejects.toThrow("not available");
    expect(await readFile(path, "utf8")).toBe("old-unreadable");
  });
  it("does not write plaintext or publish memory when OS encryption fails", async () => {
    const path = await fixture();
    const store = new ChatGptPlanStore(path, {
      encrypt: () => {
        throw Error("Locked keychain");
      },
      decrypt: cipher.decrypt,
    });
    await expect(store.load()).rejects.toThrow("Locked");
    await expect(readFile(path)).rejects.toThrow();
    expect(() => store.hostId()).toThrow("not available");
  });
});
