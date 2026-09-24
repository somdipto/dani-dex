import { describe, expect, it } from "vitest";
import { hermesServesProvider } from "./hermes-acp-driver";
import {
  currentModelSource,
  hasModelSource,
  modelSourceChoices,
  modelSourceProviders,
  setRuntimeModelSource,
  withModelSource,
} from "./model-source";
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

describe("runtime model source", () => {
  const dani = {
    id: "dani",
    name: "Dani",
    baseUrl: "http://127.0.0.1:4410/v1",
    models: [{ id: "auto", name: "Dani" }],
    headers: [{ name: "x-api-key", value: "install-key" }],
    apiKey: "install-key",
  };

  it("replaces the build-time source for every spawn until it is cleared", () => {
    try {
      expect(currentModelSource()).toBeNull();
      setRuntimeModelSource(dani);
      expect(currentModelSource()).toBe(dani);
      expect(hasModelSource()).toBe(true);
      // OpenCode moves to its own CLI so the proxy is the one in use.
      expect(hermesServesProvider("opencode", () => "go-key")).toBe(false);
      // The proxy's own key wins over a saved OpenCode Go key.
      expect(
        withModelSource(
          () => [],
          () => "go-key",
        )(),
      ).toEqual([
        expect.objectContaining({ id: "dani", apiKey: "install-key", models: [{ id: "auto", name: "Dani" }] }),
      ]);
    } finally {
      setRuntimeModelSource(null);
    }
    expect(currentModelSource()).toBeNull();
    expect(hermesServesProvider("opencode", () => "go-key")).toBe(true);
  });
});

describe("model source choices", () => {
  const dani = {
    id: "dani",
    name: "Dani",
    baseUrl: "http://127.0.0.1:4410/v1",
    models: [{ id: "auto", name: "Dani Free Auto" }],
  };
  const listed = [
    { id: "opencode/big-pickle", provider: "opencode" },
    { id: "claude-sonnet", provider: "claude" },
    { id: "dani/auto", provider: "opencode" },
  ];

  it("offers only the source's model once it is listed", () => {
    expect(modelSourceChoices(listed, dani)).toEqual([{ id: "dani/auto", provider: "opencode" }]);
  });

  it("keeps the list while the source's model is not listed yet, and with no source", () => {
    expect(modelSourceChoices(listed.slice(0, 2), dani)).toEqual(listed.slice(0, 2));
    expect(modelSourceChoices(listed, null)).toEqual(listed);
  });
});
