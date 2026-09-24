/**
 * Where Dani-Dex's own online services live.
 *
 * Every value is `null` until Dan Lab runs the service. The upstream project's servers are never a
 * default: an invite, a plugin link, a team host or the account API must not route a Dani-Dex user
 * through infrastructure Dan Lab does not operate. While a value is null, the feature that needs it
 * either uses the `dani-dex://` link form, which needs no server, or reports itself unavailable.
 *
 * When a Dan Lab service goes live, set its origin here. `online-services.test.ts` and
 * `scripts/check-upstream-references.ts` keep the upstream hosts out of these defaults.
 */

/** The public web origin invitation and plugin pages are served from. */
export const DANI_DEX_WEB_ORIGIN: string | null = null;

/** The account and team control-plane API a packaged app talks to. */
export const DANI_DEX_API_ORIGIN: string | null = null;

/** The DNS suffix of published team hosts, such as `.example.com` for `<slug>-<id>-host.example.com`. */
export const DANI_DEX_TEAM_HOST_SUFFIX: string | null = null;

/** Where product analytics are sent. Null sends nothing. */
export const DANI_DEX_ANALYTICS_API_URL: string | null = null;

/** The DNS suffix published sites live under, such as `.example.site`. Null publishes nowhere. */
export const DANI_DEX_HOSTED_SITE_SUFFIX: string | null = null;
