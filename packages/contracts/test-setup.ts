import { vi } from "vitest";

// Online-feature tests use reserved fixture hosts; shipped defaults stay null.
// The standalone package runner needs the same seam as the root desktop runner.
vi.mock("./src/online-services", () => ({
  DANI_DEX_WEB_ORIGIN: "https://dani-dex.example",
  DANI_DEX_API_ORIGIN: "https://api.dani-dex.example",
  DANI_DEX_TEAM_HOST_SUFFIX: ".dani-dex.example",
  DANI_DEX_ANALYTICS_API_URL: "https://analytics.dani-dex.example/api",
  DANI_DEX_HOSTED_SITE_SUFFIX: ".sites.dani-dex.example",
  DANI_DEX_MODEL_SOURCE: null,
}));
