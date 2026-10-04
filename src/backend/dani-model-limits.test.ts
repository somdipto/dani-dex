import { expect, it } from "vitest";
import { buildDaniModelSource } from "../main/dani-free";
import { modelSourceProviders } from "./model-source";
import { customProviderEntries } from "./opencode-config";

const ready = {
  baseUrl: "http://127.0.0.1:12345",
  port: 12345,
  pid: 1,
  apiKeyFile: "/tmp/test-key",
  privateMode: false,
};
it("preserves live Auto limits through the generated OpenCode config", () => {
  const source = buildDaniModelSource(
    ready,
    "fixture",
    ["dani-free-auto"],
    [{ id: "dani-free-auto", contextWindow: 1048576, maxTokens: 524288 }],
  );
  expect(customProviderEntries(modelSourceProviders(source))?.dani.models["dani-free-auto"]).toMatchObject({
    name: "Dani Free Auto",
    limit: { context: 1048576, output: 32000 },
  });
});
it("never advertises more output than the endpoint or context allows", () => {
  const source = buildDaniModelSource(
    ready,
    "fixture",
    ["dani-free-auto"],
    [{ id: "dani-free-auto", contextWindow: 16000, maxTokens: 8000 }],
  );
  expect(source.models[0]?.limit).toEqual({ context: 16000, output: 8000 });
});
it("does not fabricate limits from malformed or absent metadata", () => {
  const source = buildDaniModelSource(
    ready,
    "fixture",
    ["dani-free-auto"],
    [{ id: "dani-free-auto", contextWindow: 1000, maxTokens: -1 }],
  );
  expect(source.models[0]?.limit).toBeUndefined();
});

it("creates only proxy-proven effort variants and disables invented levels", () => {
  const source = buildDaniModelSource(
    ready,
    "fixture",
    ["dani-free-auto"],
    [
      {
        id: "dani-free-auto",
        reasoningControlKey: "reasoning_effort",
        reasoningEffortLevels: ["low", "high", "max", "xhigh", "bogus"],
      },
    ],
  );
  const model = customProviderEntries(modelSourceProviders(source))?.dani.models["dani-free-auto"];
  expect(model?.reasoning).toBe(true);
  expect(model?.variants).toEqual({
    low: { reasoningEffort: "low" },
    medium: { disabled: true },
    high: { reasoningEffort: "high" },
    xhigh: { disabled: true },
    max: { reasoningEffort: "max" },
  });
});
it("keeps effort unsupported when the proxy advertises no levels or an unknown control", () => {
  for (const metadata of [
    [],
    [{ id: "dani-free-auto", reasoningEffortLevels: ["high"], reasoningControlKey: "unknown" }],
  ]) {
    const source = buildDaniModelSource(ready, "fixture", ["dani-free-auto"], metadata);
    const model = customProviderEntries(modelSourceProviders(source))?.dani.models["dani-free-auto"];
    expect(model?.reasoning).toBe(false);
    expect(Object.values(model?.variants ?? {}).every((variant) => variant.disabled)).toBe(true);
  }
});
