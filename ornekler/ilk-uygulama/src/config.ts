import { MILOFLY_ENVIRONMENTS, type MiloflyEnvironment } from "@milofly/app-server";

/** Required setting; the app does not start without it (no silent defaults). */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is required (see README.md).`);
  return value;
}

/**
 * `MILOFLY_ENVIRONMENT=production` uses the published Milofly endpoints. `custom` reads
 * `MILOFLY_API_BASE_URL` and `MILOFLY_PANEL_ORIGIN` (a local Milofly during development).
 */
function environment(): MiloflyEnvironment {
  const name = required("MILOFLY_ENVIRONMENT");
  if (name === "production") return MILOFLY_ENVIRONMENTS.production;
  if (name === "custom") return { apiBaseUrl: required("MILOFLY_API_BASE_URL"), panelOrigin: required("MILOFLY_PANEL_ORIGIN") };
  throw new Error(`MILOFLY_ENVIRONMENT must be "production" or "custom" (got "${name}").`);
}

export const config = {
  environment: environment(),
  appKey: required("MILOFLY_APP_KEY"),
  clientId: required("MILOFLY_CLIENT_ID"),
  clientSecret: required("MILOFLY_CLIENT_SECRET"),
  /** Webhook signing secret. It also signs the session tokens of your embedded pages. */
  signingSecret: required("MILOFLY_SIGNING_SECRET"),
  /** Public origin of this app (https in production). */
  appOrigin: required("APP_ORIGIN"),
  port: Number(required("PORT")),
};
