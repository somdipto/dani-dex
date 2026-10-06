import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CentralAuthState } from "@dani-dex/contracts/ipc";
import { afterEach, expect, it, vi } from "vitest";
import { applyDevelopmentRemoteAccount, ensureDevelopmentAccount } from "./development-remote-bootstrap";
import { readSetupState, writeSetupState } from "./setup-store";
import { TeamStore } from "./team-store";

const email = "dani-dex-dev-host@example.com";
const user = { id: "seeded-owner", email, name: null, avatarUrl: null };
const cooldown: CentralAuthState = {
  status: "error",
  issue: {
    code: "code_recently_sent",
    message: "Wait 8 seconds before requesting another code.",
    retryAfterSeconds: 8,
  },
};

function authManager() {
  return {
    initialize: vi.fn<() => Promise<CentralAuthState>>().mockResolvedValue({ status: "signed_out" }),
    logout: vi.fn<() => Promise<CentralAuthState>>().mockResolvedValue({ status: "signed_out" }),
    requestEmailCode: vi.fn<(email: string) => Promise<CentralAuthState>>().mockResolvedValue({
      status: "code_sent",
      email,
      challengeId: "challenge",
      developmentCode: "123456",
      expiresAt: Date.now() + 600_000,
      resendAvailableAt: Date.now() + 60_000,
    }),
    verifyEmailCode: vi
      .fn<(id: string, code: string) => Promise<CentralAuthState>>()
      .mockResolvedValue({ status: "signed_in", user }),
  };
}

afterEach(() => vi.useRealTimers());

it.each([false, true])("uses free setup for a new dev client and preserves completed setup (%s)", async (completed) => {
  const root = await mkdtemp(join(tmpdir(), "dani-dev-client-"));
  try {
    const setupFile = join(root, "setup.json");
    if (completed) await writeSetupState(setupFile, { preferredProvider: "codex", preferredModel: "gpt-5.6-luna" });
    const teamStore = new TeamStore(join(root, "team.json"));
    await teamStore.initialize();
    const manager = authManager();
    manager.verifyEmailCode.mockResolvedValue({
      status: "signed_in",
      user: { ...user, email: "dani-dex-dev-client@example.com" },
    });
    await applyDevelopmentRemoteAccount({
      role: "client",
      testClientEnabled: true,
      centralAuth: manager,
      teamStore,
      setupFile,
      setupCompleted: completed,
    });
    await expect(readSetupState(setupFile)).resolves.toEqual({
      completed: true,
      preferredProvider: completed ? "codex" : "opencode",
      preferredModel: completed ? "gpt-5.6-luna" : null,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("signs the seeded owner in after another dev instance triggered the resend cooldown", async () => {
  vi.useFakeTimers();
  const manager = authManager();
  manager.requestEmailCode.mockResolvedValueOnce(cooldown);
  const signedIn = ensureDevelopmentAccount(manager, email);
  await vi.advanceTimersByTimeAsync(7_999);
  expect(manager.verifyEmailCode).not.toHaveBeenCalled();
  expect(manager.requestEmailCode).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(signedIn).resolves.toEqual(user);
  expect(manager.requestEmailCode).toHaveBeenLastCalledWith(email);
  expect(manager.verifyEmailCode).toHaveBeenCalledWith("challenge", "123456");
});

it("stops after one cooldown retry and reports the API error", async () => {
  vi.useFakeTimers();
  const manager = authManager();
  manager.requestEmailCode.mockResolvedValue(cooldown);
  const rejected = expect(ensureDevelopmentAccount(manager, email)).rejects.toThrow(cooldown.issue.message);
  await vi.advanceTimersByTimeAsync(8_000);
  await rejected;
  expect(manager.requestEmailCode).toHaveBeenCalledTimes(2);
});

it("reuses an existing seeded session without requesting another code", async () => {
  const manager = authManager();
  manager.initialize.mockResolvedValue({ status: "signed_in", user });
  await expect(ensureDevelopmentAccount(manager, email)).resolves.toEqual(user);
  expect(manager.requestEmailCode).not.toHaveBeenCalled();
});

it("reports non-cooldown sign-in failures without retrying", async () => {
  const manager = authManager();
  manager.requestEmailCode.mockResolvedValue({
    status: "error",
    issue: { code: "email_rate_limited", message: "Too many requests." },
  });
  await expect(ensureDevelopmentAccount(manager, email)).rejects.toThrow("Too many requests.");
  expect(manager.requestEmailCode).toHaveBeenCalledTimes(1);
});
