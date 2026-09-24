import { vi } from "vitest";

/*
 * Shipped builds name no online service (every value in online-services.ts is null). Tests of the
 * online features run against a configured stand-in on the reserved `.example` domain, never against
 * a real host. A test that checks the shipped defaults calls `vi.unmock` on the module. Module
 * mocking is the seam here: the values are build-time constants, not an injectable service.
 */
vi.mock("@dani-dex/contracts/online-services", () => ({
  DANI_DEX_WEB_ORIGIN: "https://dani-dex.example",
  DANI_DEX_API_ORIGIN: "https://api.dani-dex.example",
  DANI_DEX_TEAM_HOST_SUFFIX: ".dani-dex.example",
  DANI_DEX_ANALYTICS_API_URL: "https://analytics.dani-dex.example/api",
  DANI_DEX_HOSTED_SITE_SUFFIX: ".sites.dani-dex.example",
}));
