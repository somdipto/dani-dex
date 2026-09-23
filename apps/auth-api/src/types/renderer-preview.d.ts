declare module "@dani-dex/renderer-preview" {
  import type { JSX } from "@solidjs/web";

  export interface DaniDexPlaygroundProps {
    variant?: "default" | "landing";
  }

  export function DaniDexPlayground(props: DaniDexPlaygroundProps): JSX.Element;
}
