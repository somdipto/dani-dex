// No Vite-only import belongs in this file. `vite.config.ts` reads it, through the
// news artwork generator, while plain Node loads the config, and Node cannot
// resolve an `?url` specifier. That is why the font asset arrives as an argument
// from the root route instead of as an import here.

export const DANI_DEX_SITE_URL = "https://openbot.run/";
export const DANI_DEX_SITE_TITLE = "Dani-Dex: AI teammates for real work";
export const DANI_DEX_SITE_DESCRIPTION =
  "Run Codex and Claude side by side as persistent AI teammates, each with its own workspace, queue, and context.";
export const DANI_DEX_SOCIAL_IMAGE_URL = `${DANI_DEX_SITE_URL}dani-dex-social.png`;
export const DANI_DEX_SOCIAL_IMAGE_ALT = "Meet Dani-Dex on a dark grid background";

// The hosts production answers on. Both serve the same pages, and those pages go by
// openbot.run.
const DANI_DEX_PRODUCTION_HOSTS = new Set(["openbot.run", "api.openbot.run"]);

/**
 * The site that the head tags of a page served at `pageUrl` name. Social sites fetch
 * `og:url` and `og:image` themselves and show no card when those answer 404. A
 * pull-request preview serves pages and images that openbot.run does not have yet,
 * so any host other than production names itself. Cloudflare marks preview URLs
 * `noindex`, so a preview canonical does not compete with production.
 */
export function siteUrlForPage(pageUrl: URL): string {
  return DANI_DEX_PRODUCTION_HOSTS.has(pageUrl.hostname) ? DANI_DEX_SITE_URL : `${pageUrl.origin}/`;
}

export const DANI_DEX_SOFTWARE_APPLICATION = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Dani-Dex",
  url: DANI_DEX_SITE_URL,
  image: DANI_DEX_SOCIAL_IMAGE_URL,
  description: DANI_DEX_SITE_DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  operatingSystem: ["macOS 13 or later", "Windows 10 or later"],
  downloadUrl: [`${DANI_DEX_SITE_URL}download/macos`, `${DANI_DEX_SITE_URL}download/windows`],
  isAccessibleForFree: true,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  sameAs: ["https://github.com/nightly-labs/openbot"],
} as const;

export const DANI_DEX_SECURITY_HEADERS = {
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
} as const;

/**
 * @param interLatinFont The hashed URL of Inter's upright latin range, the one font
 * file this site downloads. It is reached through two levels of CSS `@import`, so a
 * browser only learns of it after the stylesheet has parsed. That is late enough
 * that the first paint uses a fallback face and every line of text moves when Inter
 * replaces it. The caller passes the same hashed asset the `@font-face` rule asks
 * for, so the preload below is that request and not a second one.
 */
export function daniDexRootHead(interLatinFont: string) {
  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: DANI_DEX_SITE_TITLE },
      { name: "description", content: DANI_DEX_SITE_DESCRIPTION },
      { name: "application-name", content: "Dani-Dex" },
      { name: "color-scheme", content: "dark" },
      { name: "theme-color", content: "#1a1a1a" },
    ],
    links: [
      {
        rel: "preload",
        as: "font" as const,
        type: "font/woff2",
        href: interLatinFont,
        crossorigin: "anonymous" as const,
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  };
}

export function daniDexHomeHead() {
  return {
    meta: [
      { "script:ld+json": DANI_DEX_SOFTWARE_APPLICATION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Dani-Dex" },
      { property: "og:locale", content: "en_US" },
      { property: "og:url", content: DANI_DEX_SITE_URL },
      { property: "og:title", content: DANI_DEX_SITE_TITLE },
      { property: "og:description", content: DANI_DEX_SITE_DESCRIPTION },
      { property: "og:image", content: DANI_DEX_SOCIAL_IMAGE_URL },
      { property: "og:image:type", content: "image/png" },
      { property: "og:image:width", content: "1600" },
      { property: "og:image:height", content: "900" },
      { property: "og:image:alt", content: DANI_DEX_SOCIAL_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: DANI_DEX_SITE_TITLE },
      { name: "twitter:description", content: DANI_DEX_SITE_DESCRIPTION },
      { name: "twitter:image", content: DANI_DEX_SOCIAL_IMAGE_URL },
      { name: "twitter:image:alt", content: DANI_DEX_SOCIAL_IMAGE_ALT },
    ],
    links: [{ rel: "canonical", href: DANI_DEX_SITE_URL }],
  };
}
