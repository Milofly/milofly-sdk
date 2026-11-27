/**
 * Published Milofly endpoints. There is no implicit environment: pass one of these (or your own
 * object for a local Milofly) to `createClient`, `exchangeCode` and `buildInstallUrl`.
 */
export interface MiloflyEnvironment {
  /** Base of the app API (`/api/apps/**`). */
  apiBaseUrl: string;
  /** Origin of the store panel that embeds apps and shows the install (consent) screen. */
  panelOrigin: string;
}

export const MILOFLY_ENVIRONMENTS = Object.freeze({
  production: Object.freeze({
    apiBaseUrl: "https://api.milofly.com",
    panelOrigin: "https://app.milofly.com",
  } satisfies MiloflyEnvironment),
});
