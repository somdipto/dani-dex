import { describe, expect, it } from "vitest";
import { AGENT_HARNESS_DESCRIPTORS, agentHarnessDescriptor, isAgentHarness } from "./agent-harnesses";

describe("agent harness registry", () => {
  it("keeps harness selection separate from provider selection", () => {
    expect(AGENT_HARNESS_DESCRIPTORS.map(({ id }) => id)).toEqual(["hermes", "omp"]);
    expect(agentHarnessDescriptor("hermes")).toMatchObject({ default: true, available: true });
    expect(agentHarnessDescriptor("omp")).toMatchObject({ default: false, available: false });
  });

  it("rejects providers and unknown harnesses", () => {
    expect(isAgentHarness("hermes")).toBe(true);
    expect(isAgentHarness("opencode")).toBe(false);
    expect(isAgentHarness("mypi")).toBe(false);
  });
});
