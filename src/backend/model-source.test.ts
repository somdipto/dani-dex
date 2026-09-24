import { describe, expect, it } from "vitest";
import { hermesServesProvider } from "./hermes-acp-driver";
import { hasModelSource, modelSourceProviders, withModelSource } from "./model-source";
import { mergeOpenCodeConfig } from "./opencode-config";

const PROXY = {
  id: "danlab",
  name: "Dan Lab",
  baseUrl: "https://proxy.example/v1",
  models: [{ id: "fast", name: "Fast" }],
  headers: [{ name: "X-Client", value: "dani-dex" }],
};

describe("model source seam", () => {
  it("keeps OpenCode's own catalog while no source is set", () => {
    expect(modelSourceProviders(null)).toEqual([]);
    expect(hasModelSource(null)).toBe(false);
    expect(
      withModelSource(
        () => [],
        () => null,
        null,
      )(),
    ).toEqual([]);
  });

  it("hands a set source to OpenCode as one provider, before the user's own endpoints", () => {
    const user = {
      id: "lmstudio",
      name: "LM Studio",
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: null,
      models: [{ id: "local", name: "Local" }],
      headers: [],
    };
    const providers = withModelSource(
      () => [user],
      () => "go-key",
      PROXY,
    )();
    expect(providers.map((provider) => provider.id)).toEqual(["danlab", "lmstudio"]);
    expect(providers[0]).toMatchObject({ baseUrl: "https://proxy.example/v1", apiKey: "go-key" });
    expect(mergeOpenCodeConfig({}, providers)?.provider?.danlab).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "Dan Lab",
      options: { baseURL: "https://proxy.example/v1", apiKey: "go-key", headers: { "X-Client": "dani-dex" } },
      models: { fast: { name: "Fast" } },
    });
  });

  it("keeps OpenCode on its own CLI whenever a source is set, so the source is always the one used", () => {
    expect(hermesServesProvider("opencode", () => "go-key", null)).toBe(true);
    expect(hermesServesProvider("opencode", () => "go-key", PROXY)).toBe(false);
    expect(hermesServesProvider("opencode", () => null, null)).toBe(false);
  });
});
