import { createSignal, onCleanup } from "solid-js";
import { isDaniOnly } from "./provider-model-options";

/** How often to re-read an empty model list, and when to give up. The free service starts after the window does. */
const RETRY_MS = 1500;
const MAX_ATTEMPTS = 40;

/**
 * Whether Dani's free models are the product's only model right now, read from the live model list,
 * the same source the model picker uses. At launch the list is empty, or still the engine's own
 * catalogue, until the free service is serving, so a "no" is re-read for the first minute rather
 * than taken as final. The read is an in-memory copy in the main process, so the retries are cheap. While it is
 * undecided or the read fails, everything shows, which is the safe default for a screen that offers
 * choices.
 */
export function useDaniOnly(): () => boolean {
  const [daniOnly, setDaniOnly] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let attempts = 0;

  function read(): void {
    attempts += 1;
    void window.danidex.agent
      .listModels()
      .then((models) => {
        if (disposed) return;
        const only = isDaniOnly(models);
        setDaniOnly(only);
        if (!only) retry();
      })
      .catch(() => {
        if (disposed) return;
        setDaniOnly(false);
        retry();
      });
  }

  function retry(): void {
    if (attempts < MAX_ATTEMPTS) timer = setTimeout(read, RETRY_MS);
  }

  read();
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
  });
  return daniOnly;
}
