// @vitest-environment node
import { describe, expect, it } from "vitest";
import { harnessDriverResolver, hermesEnvironment, hermesSignInMessage } from "./hermes-acp-driver";
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
    expect(hermesSignInMessage("opencode")).toContain("OpenCode Go key");
  });
});
