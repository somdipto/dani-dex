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

/**
 * Where OpenCode's models come from: the one switch for the model source.
 *
 * Null means OpenCode's own catalog, which lists its free models with no account. Set it to an
 * OpenAI-compatible endpoint (`<baseUrl>/chat/completions`) and every OpenCode agent uses it
 * instead, with no other change: `src/backend/model-source.ts` hands it to the OpenCode process as
 * one provider, and the harness keeps OpenCode on its own CLI so the endpoint is always the one in
 * use. This is where Dan Lab's own proxy goes when it runs.
 */
export interface DaniDexModelSource {
  /** The provider id model ids are prefixed with, such as `danlab` for `danlab/<model>`. */
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  /** The models the endpoint serves. OpenCode lists only the ones named here. */
  readonly models: readonly { readonly id: string; readonly name: string }[];
  /** Sent with every request, for a proxy that authenticates by header instead of a key. */
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
  /**
   * The source's own key, sent as the bearer key. Set by a proxy that mints one per install; when it
   * is absent, the OpenCode Go key saved in Settings is sent instead.
   */
  readonly apiKey?: string;
}

export const DANI_DEX_MODEL_SOURCE: DaniDexModelSource | null = null;
