import { describe, expect, it } from "vitest";
import { DANI_DEX_SECURITY_HEADERS, DANI_DEX_SITE_URL, siteUrlForPage } from "../src/lib/site-metadata";

describe("site metadata", () => {
  it("defines production security headers", () => {
    expect(DANI_DEX_SECURITY_HEADERS).toEqual({
      "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    });
  });

  it("names openbot.run on a production host and the serving site on any other", () => {
    expect(siteUrlForPage(new URL("https://openbot.run/guides/a-guide"))).toBe(DANI_DEX_SITE_URL);
    expect(siteUrlForPage(new URL("https://api.openbot.run/guides/a-guide"))).toBe(DANI_DEX_SITE_URL);
    expect(siteUrlForPage(new URL("https://pr-451-openbot-landing-preview.example.workers.dev/guides/a-guide"))).toBe(
      "https://pr-451-openbot-landing-preview.example.workers.dev/",
    );
  });
});
