/**
 * Whether Settings offers the harness picker. Users never choose a harness: the engine is part of
 * Dani-Dex, picked per agent and never shown. A developer who needs to compare harnesses builds with
 * `VITE_DANI_DEX_SHOW_HARNESS=1`; a shipped build is never built with it.
 */
export function harnessPickerVisible(): boolean {
  return import.meta.env.VITE_DANI_DEX_SHOW_HARNESS === "1";
}
