import { MiloflyApiError } from "./errors.js";
import type { MiloflyEnvironment } from "./environments.js";
import { readApiError } from "./client.js";

/** Path of the install (consent) screen in the store panel. */
export const INSTALL_PATH = "/plugins/install/";

export interface InstallUrlOptions {
  environment: Pick<MiloflyEnvironment, "panelOrigin">;
  appKey: string;
  clientId: string;
  /** Opaque, signed value you verify on your OAuth callback (CSRF protection). Returned unchanged. */
  state: string;
  /** Scopes to request; must be within the scopes registered for the app. Omit to request all of them. */
  scopes?: readonly string[];
}

/**
 * URL that opens the install screen for a merchant. The redirect URI is not part of it: Milofly
 * returns to the first redirect URI registered for your app, with `?code=…&state=…`
 * (or `?error=access_denied&state=…` when the merchant cancels).
 */
export function buildInstallUrl(options: InstallUrlOptions): string {
  if (!options.state) throw new TypeError("state is required.");
  const url = new URL(INSTALL_PATH + encodeURIComponent(options.appKey), options.environment.panelOrigin);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientId);
  if (options.scopes && options.scopes.length > 0) url.searchParams.set("scope", options.scopes.join(" "));
  url.searchParams.set("state", options.state);
  return url.toString();
}

/** A completed installation. Store the access token encrypted; it is shown only once. */
export interface InstallGrant {
  accessToken: string;
  tokenType: "Bearer";
  scopes: string[];
  appKey: string;
  storeId: number;
  regionId: number | null;
  installScope: "region" | "store";
  /** Regions the installation serves (store-wide installations only). */
  regions: { id: number; code: string; currency: string; domain: string | null }[] | null;
  storeName: string | null;
  storeDomain: string | null;
}

export interface ExchangeCodeOptions {
  environment: Pick<MiloflyEnvironment, "apiBaseUrl">;
  clientId: string;
  clientSecret: string;
  code: string;
  fetch?: typeof fetch;
}

/** Exchanges the one-time install code for an access token (server side only: needs the client secret). */
export async function exchangeCode(options: ExchangeCodeOptions): Promise<InstallGrant> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const res = await doFetch(new URL("/api/apps/oauth/token", options.environment.apiBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ clientId: options.clientId, clientSecret: options.clientSecret, code: options.code }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || body.success !== true) throw readApiError(res, body);

  const scope = body.install_scope;
  if (typeof body.access_token !== "string" || typeof body.app_key !== "string" || typeof body.store_id !== "number" || (scope !== "region" && scope !== "store"))
    throw new MiloflyApiError({ status: res.status, code: "unexpected_response", params: null, message: "Token response is missing required fields.", body, retryAfterSeconds: null });

  return {
    accessToken: body.access_token,
    tokenType: "Bearer",
    scopes: Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === "string") : [],
    appKey: body.app_key,
    storeId: body.store_id,
    regionId: typeof body.region_id === "number" ? body.region_id : null,
    installScope: scope,
    regions: Array.isArray(body.regions) ? (body.regions as InstallGrant["regions"]) : null,
    storeName: typeof body.store_name === "string" ? body.store_name : null,
    storeDomain: typeof body.store_domain === "string" ? body.store_domain : null,
  };
}
