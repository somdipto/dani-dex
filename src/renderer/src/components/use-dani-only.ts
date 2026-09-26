import { createSignal, onCleanup } from "solid-js";
import { isDaniOnly } from "./provider-model-options";

/** How often to re-read an empty model list, and when to give up. The free service starts after the window does. */
const RETRY_MS = 1500;
const MAX_ATTEMPTS = 40;

/**
 * Whether the live model list contains only keyless free choices,
 * the same source the model picker uses. The proxy and OpenCode catalog can appear at different
 * times, so a "no" is re-read for the first minute. While undecided, other sign-in choices remain
 * visible. These are in-memory reads, not downloads or logged-in website requests.
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
