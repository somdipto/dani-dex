/// <reference types="vite/client" />

import type { DaniDexDesktopApi } from "@dani-dex/contracts/ipc";

declare global {
  interface HighlightRegistry {
    set(name: string, highlight: Highlight): this;
    delete(name: string): boolean;
  }

  interface Window {
    danidex: DaniDexDesktopApi;
  }
}
