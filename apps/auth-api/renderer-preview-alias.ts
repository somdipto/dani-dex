import { fileURLToPath } from "node:url";

export const rendererPreviewAlias = fileURLToPath(
  new URL("../../src/renderer/src/preview/DaniDexPlayground.tsx", import.meta.url),
);
