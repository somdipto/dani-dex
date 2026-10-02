import { describe, expect, it, vi } from "vitest";

// Inspect the packaged configuration rather than the online-feature fixture.
vi.unmock("./online-services");

import {
  DANI_DEX_ANALYTICS_API_URL,
  DANI_DEX_API_ORIGIN,
  DANI_DEX_HOSTED_SITE_SUFFIX,
  DANI_DEX_MODEL_SOURCE,
  DANI_DEX_TEAM_HOST_SUFFIX,
  DANI_DEX_WEB_ORIGIN,
} from "./online-services";

describe("shipped online service defaults", () => {
  it("does not route users to an unconfigured online service", () => {
    expect(DANI_DEX_WEB_ORIGIN).toBeNull();
    expect(DANI_DEX_API_ORIGIN).toBeNull();
    expect(DANI_DEX_TEAM_HOST_SUFFIX).toBeNull();
    expect(DANI_DEX_ANALYTICS_API_URL).toBeNull();
    expect(DANI_DEX_HOSTED_SITE_SUFFIX).toBeNull();
    expect(DANI_DEX_MODEL_SOURCE).toBeNull();
  });
});
