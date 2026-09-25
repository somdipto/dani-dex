// @vitest-environment node
import { delimiter } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  harnessDriverResolver,
  hermesEnvironment,
  hermesProviderDriver,
  hermesSignInMessage,
} from "./hermes-acp-driver";
import type { repairHermesHome } from "./hermes-repair";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "./provider-drivers";

describe("Hermes harness drivers", () => {
  it("maps each signed-in provider to Hermes' own inference provider inside Dani-Dex's Hermes home", () => {
    const options = { hermesHome: "/data/Dani-Dex/hermes" };
    expect(hermesEnvironment("codex", NO_PROVIDER_CREDENTIALS, options)).toEqual({
      HERMES_HOME: "/data/Dani-Dex/hermes",
      HERMES_INFERENCE_PROVIDER: "openai-codex",
    });
    expect(hermesEnvironment("claude", NO_PROVIDER_CREDENTIALS, options).HERMES_INFERENCE_PROVIDER).toBe("anthropic");
    const withKey = { ...NO_PROVIDER_CREDENTIALS, apiKey: () => "go-key" };
    expect(hermesEnvironment("opencode", withKey, options)).toMatchObject({
      HERMES_INFERENCE_PROVIDER: "opencode-go",
      OPENCODE_GO_API_KEY: "go-key",
    });
    // A key saved for OpenCode never leaks into another provider's Hermes process.
    expect(hermesEnvironment("codex", withKey, options)).not.toHaveProperty("OPENCODE_GO_API_KEY");
  });

  it("keeps native drivers without a harness, runs Hermes with one, and refuses OMP", () => {
    expect(harnessDriverResolver(null, { hermesHome: "/h" })("codex")).toBe(requireProviderDriver("codex"));
    const hermes = harnessDriverResolver("hermes", { hermesHome: "/h" });
    const driver = hermes("claude");
    expect(driver.id).toBe("claude");
    expect(driver.signIn).toEqual({ kind: "external" });
    expect(hermes("claude")).toBe(driver);
    expect(() => harnessDriverResolver("omp", { hermesHome: "/h" })).toThrow("OMP is not available");
  });

  it("runs a provider on its own CLI when Hermes cannot use the sign-in the user already has", () => {
    let key: string | null = null;
    const hermes = harnessDriverResolver("hermes", { hermesHome: "/h", apiKey: () => key });
    // Codex and Grok logins never reach Hermes, so those providers keep their own CLI.
    expect(hermes("codex")).toBe(requireProviderDriver("codex"));
    expect(hermes("grok")).toBe(requireProviderDriver("grok"));
    // OpenCode without a Go key lists its free models natively; with one, Hermes runs it.
    expect(hermes("opencode")).toBe(requireProviderDriver("opencode"));
    key = "go-key";
    expect(hermes("opencode")).not.toBe(requireProviderDriver("opencode"));
    expect(hermes("opencode").id).toBe("opencode");
    // Claude runs under Hermes on the Claude Code login.
    expect(hermes("claude")).not.toBe(requireProviderDriver("claude"));
  });

  it("tells the user which sign-in Hermes borrows", () => {
    expect(hermesSignInMessage("codex")).toBe("Sign in to ChatGPT to continue.");
    expect(hermesSignInMessage("claude")).not.toMatch(/hermes/iu);
    expect(hermesSignInMessage("opencode")).toContain("model key");
    expect(hermesSignInMessage("opencode")).not.toMatch(/opencode/iu);
  });

  // Hermes' computer-use tool looks for `cua-driver` on its PATH and reads as unavailable otherwise.
  it("puts the shipped Computer Use driver on Hermes' PATH, with the vendor calls off", () => {
    const env = hermesEnvironment("claude", NO_PROVIDER_CREDENTIALS, {
      hermesHome: "/h",
      computerUse: () => ({
        executable: "/App/Resources/cua-driver/darwin/arm64/cua-driver",
        env: { CUA_DRIVER_RS_TELEMETRY_ENABLED: "0" },
      }),
    });
    expect(env.HERMES_CUA_DRIVER_CMD).toBe("/App/Resources/cua-driver/darwin/arm64/cua-driver");
    expect(env.PATH?.split(delimiter)[0]).toBe("/App/Resources/cua-driver/darwin/arm64");
    expect(env.CUA_DRIVER_RS_TELEMETRY_ENABLED).toBe("0");
    expect(env.HERMES_HOME).toBe("/h");
    // No driver on this computer: nothing is added, and Hermes keeps the PATH it inherits.
    const without = hermesEnvironment("claude", NO_PROVIDER_CREDENTIALS, { hermesHome: "/h", computerUse: () => null });
    expect(without).not.toHaveProperty("PATH");
    expect(without).not.toHaveProperty("HERMES_CUA_DRIVER_CMD");
  });

  it("repairs Hermes' state once before the providers it serves start, and again after a failed repair", async () => {
    const hermes = process.env.DANI_DEX_HERMES_TEST_PATH?.trim();
    if (!hermes) return;
    const repair = vi.fn<typeof repairHermesHome>(async () => "failed");
    const options = { hermesHome: `/tmp/dani-dex-repair-${Date.now()}`, bundledExecutable: hermes, repair };
    await hermesProviderDriver("claude", options).resolveCli({});
    expect(repair).toHaveBeenCalledOnce();
    await hermesProviderDriver("opencode", options).resolveCli({});
    expect(repair).toHaveBeenCalledTimes(2);
    repair.mockResolvedValue("healthy");
    await hermesProviderDriver("claude", options).resolveCli({});
    await hermesProviderDriver("opencode", options).resolveCli({});
    expect(repair).toHaveBeenCalledTimes(3);
  }, 60_000);
});
