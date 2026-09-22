import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/app-preview")({
  head: () => ({
    meta: [{ title: "Dani-Dex application preview" }, { name: "robots", content: "noindex, follow" }],
  }),
  headers: () => ({ "X-Robots-Tag": "noindex, follow" }),
});
