import { createSignal } from "solid-js";
import { isDaniOnly } from "./provider-model-options";

/**
 * Whether Dani's free models are the product's only model right now. Read once from the live model
 * list, the same source the model picker uses. While it is undecided or the read fails, everything
 * shows, which is the safe default for a screen that offers choices.
 */
export function useDaniOnly(): () => boolean {
  const [daniOnly, setDaniOnly] = createSignal(false);
  void window.danidex.agent
    .listModels()
    .then((models) => setDaniOnly(isDaniOnly(models)))
    .catch(() => setDaniOnly(false));
  return daniOnly;
}
