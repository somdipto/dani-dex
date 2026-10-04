import { expect, it } from "vitest";
import { modelSourceEfforts } from "./model-source";

const source = {
  id: "dani",
  name: "Dani",
  baseUrl: "http://127.0.0.1:1234/v1",
  models: [{ id: "dani-free-auto", name: "Auto", reasoningEffortLevels: ["low", "high"] as const }],
};
it("intersects actual CLI and proxy effort support", () => {
  expect(modelSourceEfforts("dani/dani-free-auto", ["medium", "high", "max"], source)).toEqual(["high"]);
});
it("keeps unsupported Auto effort empty rather than substituting Medium", () => {
  expect(
    modelSourceEfforts("dani/dani-free-auto", ["medium"], {
      ...source,
      models: [{ id: "dani-free-auto", name: "Auto" }],
    }),
  ).toEqual([]);
});
it("does not restrict another provider's CLI capability", () => {
  expect(modelSourceEfforts("opencode/free", ["medium", "max"], source)).toBeNull();
});
