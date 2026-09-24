// The seam between OpenCode and the service its models come from.
//
// `DANI_DEX_MODEL_SOURCE` in `@dani-dex/contracts/online-services` is the build-time setting, and
// `setRuntimeModelSource` replaces it while this process runs: the bundled Dani-Free proxy reports
// its address, key and models only after it starts. Null keeps
// OpenCode's own catalog (its free models, no account). A value is an OpenAI-compatible endpoint that
// replaces it: this module turns it into one more provider on the `OPENCODE_CONFIG_CONTENT` layer
// Dani-Dex already writes for the user's own endpoints, so a proxy is a config value, not a code
// change. The OpenCode Go key saved in Settings, when there is one, is sent to the source as its key.

import { DANI_DEX_MODEL_SOURCE, type DaniDexModelSource } from "@dani-dex/contracts/online-services";
import type { CustomProviderConfig, CustomProviderSource } from "./opencode-config";

let runtimeSource: DaniDexModelSource | null = null;

/**
 * Replaces the build-time source for this process, or gives it back with `null`. Read at each spawn,
 * so the caller restarts OpenCode (through the endpoint-change path) for a running process to see it.
 */
export function setRuntimeModelSource(source: DaniDexModelSource | null): void {
  runtimeSource = source;
}

/** The source a spawn uses now: the runtime one when the proxy is up, otherwise the build-time one. */
export function currentModelSource(): DaniDexModelSource | null {
  return runtimeSource ?? DANI_DEX_MODEL_SOURCE;
}

/** The configured source as an OpenCode provider, or nothing while OpenCode's own catalog is used. */
export function modelSourceProviders(
  source: DaniDexModelSource | null = currentModelSource(),
  apiKey: string | null = null,
): CustomProviderConfig[] {
  if (!source || source.models.length === 0) return [];
  return [
    {
      id: source.id,
      name: source.name,
      baseUrl: source.baseUrl,
      apiKey: source.apiKey ?? apiKey,
      models: source.models.map((model) => ({ id: model.id, name: model.name })),
      headers: (source.headers ?? []).map((header) => ({ name: header.name, value: header.value })),
    },
  ];
}

/** The endpoints one OpenCode process gets: the model source first, then the user's own endpoints. */
export function withModelSource(
  custom: CustomProviderSource,
  apiKey: () => string | null,
  source: DaniDexModelSource | null = currentModelSource(),
): CustomProviderSource {
  return () => [
    ...modelSourceProviders(source, apiKey()),
    ...custom().filter((provider) => provider.id !== source?.id),
  ];
}

/** Whether a model source replaces OpenCode's own catalog. */
export function hasModelSource(source: DaniDexModelSource | null = currentModelSource()): boolean {
  return modelSourceProviders(source).length > 0;
}
