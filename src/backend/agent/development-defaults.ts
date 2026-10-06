import {
  type AgentModelId,
  type AgentModelOption,
  type AgentProviderId,
  type AgentReasoningEffort,
  defaultProviderModel,
} from "@dani-dex/contracts/ipc";

/** Development and packaged builds use the same free default. Explicit saved choices take precedence. */
export const DEVELOPMENT_DEFAULT_PROVIDER: AgentProviderId = "opencode";
export const DEVELOPMENT_DEFAULT_MODEL: AgentModelId = defaultProviderModel(DEVELOPMENT_DEFAULT_PROVIDER);
export const DEVELOPMENT_DEFAULT_REASONING_EFFORT: AgentReasoningEffort = "low";

/** Use the free default only after the live catalog and provider are ready. */
export function developmentStartingModel(input: {
  enabled: boolean;
  models: readonly AgentModelOption[];
  providerAvailable: (provider: AgentProviderId) => boolean;
}): AgentModelOption | null {
  if (!input.enabled) return null;
  const listed = input.models.find(
    (model) => model.provider === DEVELOPMENT_DEFAULT_PROVIDER && model.id === DEVELOPMENT_DEFAULT_MODEL,
  );
  if (!listed || !input.providerAvailable(DEVELOPMENT_DEFAULT_PROVIDER)) return null;
  return listed.supportedReasoningEfforts.includes(DEVELOPMENT_DEFAULT_REASONING_EFFORT)
    ? { ...listed, defaultReasoningEffort: DEVELOPMENT_DEFAULT_REASONING_EFFORT }
    : listed;
}
