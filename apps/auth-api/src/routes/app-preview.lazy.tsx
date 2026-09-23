import { createLazyFileRoute } from "@tanstack/solid-router";
import { createSignal, lazy, onSettled, Show } from "solid-js";
import "../../../../src/renderer/src/preview/preview.css";

const DaniDexPlayground = lazy(() =>
  import("@dani-dex/renderer-preview").then((module) => ({ default: module.DaniDexPlayground })),
);

export const Route = createLazyFileRoute("/app-preview")({ component: AppPreviewPage });

export function AppPreviewPage() {
  const [mounted, setMounted] = createSignal(false);
  onSettled(() => {
    setMounted(true);
  });

  return (
    <div id="root" class="openbot-playground-root" data-preview-variant="landing">
      <Show
        when={mounted()}
        fallback={<div class="openbot-playground-loading" role="status" aria-label="Loading Dani-Dex preview" />}
      >
        <DaniDexPlayground variant="landing" />
      </Show>
    </div>
  );
}
