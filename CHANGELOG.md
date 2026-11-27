# Changelog

All packages in this repository are released together with the same version. Details per package are in
`js/<package>/CHANGELOG.md`.

## 0.1.1 (2026-11-27)

First release from GitHub Actions with npm trusted publishing and provenance. No functional change.

## 0.1.0 (2026-11-27)

First public version.

- `@milofly/cli` 0.1.0: browser sign-in, `theme init|pull|check|dev|push|pack|submit|list`, `app init`.
- `@milofly/app-bridge` 0.1.0: `createApp` client, bridge contract v2, host engine for the Milofly panel.
- `@milofly/app-server` 0.1.0: `verifyWebhook`, `verifySessionToken`, `buildInstallUrl`, `exchangeCode`, `createClient`,
  `signingKeyId`.
- `@milofly/theme-sdk` 0.1.0: manifest v1 types, theme project read/write, theme assets, component schema validators.
- `Milofly.Apps` 0.1.0: `WebhookVerifier`, `SessionTokenVerifier`, `OAuthClient`, `MiloflyApiClient`, `MiloflyEnvironment`.
