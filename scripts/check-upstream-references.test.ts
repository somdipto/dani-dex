import { vi } from "vitest";

// The setup file stands in a configured service; this file checks what actually ships.
vi.unmock("@dani-dex/contracts/online-services");

import {
  createInviteUrl,
  DANI_DEX_CONTROL_PLANE_ORIGIN,
  DANI_DEX_INVITE_ORIGIN,
} from "@dani-dex/contracts/invite-links";
import * as onlineServices from "@dani-dex/contracts/online-services";
import { createPluginShareUrl, DANI_DEX_PLUGIN_ORIGIN } from "@dani-dex/contracts/plugin-links";
import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "../src/main/content-security-policy";
import { FORBIDDEN, findUpstreamReferences, scanShippedFiles, shippedFiles } from "./check-upstream-references";

describe("upstream references in shipped code", () => {
  it("scans the shipped tree and finds none", () => {
    expect(shippedFiles().length).toBeGreaterThan(500);
    expect(scanShippedFiles()).toEqual([]);
  });

  it("flags an upstream host and name but lets the allowed runtime names through", () => {
    expect(findUpstreamReferences("x.ts", 'const origin = "https://openbot.run";')).toHaveLength(1);
    expect(findUpstreamReferences("x.ts", "see github.com/nightly-labs/openbot")).toHaveLength(1);
    expect(findUpstreamReferences("x.ts", "Published on OpenBot.site")).toHaveLength(1);
    expect(findUpstreamReferences("x.ts", 'env: { GROK_OAUTH2_REFERRER: "openbot" },')).toEqual([]);
    expect(findUpstreamReferences("x.ts", '"/api/openbot/test",')).toEqual([]);
  });
});

describe("shipped online-service defaults", () => {
  it("names no upstream server", () => {
    for (const value of Object.values(onlineServices)) {
      if (value !== null) expect(String(value)).not.toMatch(FORBIDDEN);
    }
    for (const origin of [DANI_DEX_INVITE_ORIGIN, DANI_DEX_PLUGIN_ORIGIN, DANI_DEX_CONTROL_PLANE_ORIGIN]) {
      if (origin !== null) expect(origin).not.toMatch(FORBIDDEN);
    }
  });

  it("builds app links rather than upstream web links while no web origin is set", () => {
    expect(DANI_DEX_INVITE_ORIGIN).toBeNull();
    expect(createPluginShareUrl("linear")).toBe("dani-dex://plugins/linear");
    const invite = createInviteUrl({
      apiUrl: "https://quiet-fox-1.trycloudflare.com/",
      serverId: "00000000-0000-4000-8000-000000000000",
      fingerprint: "a".repeat(43),
      token: "b".repeat(43),
    });
    expect(invite.startsWith("dani-dex://join?")).toBe(true);
    expect(invite).not.toMatch(FORBIDDEN);
  });

  it("keeps upstream hosts out of the packaged content security policy", () => {
    expect(buildContentSecurityPolicy(true)).not.toMatch(FORBIDDEN);
  });
});
