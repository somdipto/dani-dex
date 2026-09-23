import { isOneOf } from "./runtime-values";

/** The execution loop around a model. Providers remain an independent choice inside the harness. */
export const AGENT_HARNESSES = ["hermes", "omp"] as const;
export type AgentHarnessId = (typeof AGENT_HARNESSES)[number];

export function isAgentHarness(value: unknown): value is AgentHarnessId {
  return isOneOf(AGENT_HARNESSES, value);
}

export interface AgentHarnessDescriptor {
  readonly id: AgentHarnessId;
  readonly displayName: string;
  readonly description: string;
  readonly default: boolean;
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

const DESCRIPTORS = {
  hermes: {
    id: "hermes",
    displayName: "Hermes",
    description: "General-purpose work and delegation",
    default: true,
    available: true,
    unavailableReason: null,
  },
  omp: {
    id: "omp",
    displayName: "OMP",
    description: "Complex engineering work",
    default: false,
    available: false,
    unavailableReason: "OMP will be enabled after its upstream runtime is selected and verified.",
  },
} as const satisfies Record<AgentHarnessId, AgentHarnessDescriptor>;

export const AGENT_HARNESS_DESCRIPTORS: readonly AgentHarnessDescriptor[] = AGENT_HARNESSES.map(
  (id) => DESCRIPTORS[id],
);

export function agentHarnessDescriptor(id: AgentHarnessId): AgentHarnessDescriptor {
  return DESCRIPTORS[id];
}
