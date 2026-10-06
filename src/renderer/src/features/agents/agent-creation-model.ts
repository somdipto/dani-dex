import {
  type AgentModelId,
  type AgentModelOption,
  type AgentProviderId,
  type AppSetupState,
  defaultProviderModel,
  isFreeOpencodeModel,
} from "@dani-dex/contracts/ipc";

export interface CreationModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
}

/** Keep an explicit saved choice when available. Otherwise use Dani Free without a paid fallback. */
export function resolveCreationModel(
  setup: AppSetupState | null,
  modelOptions: AgentModelOption[],
): CreationModelChoice | null {
  const preferred = setup?.preferredProvider ?? "opencode";
  const options = modelOptions.filter((option) => option.provider === preferred);
  if (setup?.preferredModel) {
    const kept = options.find((option) => option.id === setup.preferredModel);
    if (kept) return { provider: preferred, model: kept.id };
  }
  const defaultModel = options.find((option) => option.id === defaultProviderModel(preferred));
  if (defaultModel) return { provider: preferred, model: defaultModel.id };
  if (preferred !== "opencode" && options[0]) return { provider: preferred, model: options[0].id };
  const free =
    modelOptions.find((option) => option.provider === "opencode" && option.id === defaultProviderModel("opencode")) ??
    modelOptions.find((option) => option.provider === "opencode" && isFreeOpencodeModel(option.id, option.name));
  return free ? { provider: "opencode", model: free.id } : null;
}
