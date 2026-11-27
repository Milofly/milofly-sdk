# Changelog

## 0.1.1 (2026-11-27)

- Released from GitHub Actions with npm trusted publishing (OIDC) and provenance. No functional change.

## 0.1.0 (2026-11-27)

- First version: `login` (device authorization in the browser), `logout`, `whoami`, `theme init|pull|check|dev|push|pack|submit|list`,
  `app init`.
- Theme packages carry their own icons (SVG/PNG) and fonts (WOFF2): `theme check|push|dev` upload the files listed in
  `theme/assets.json` that Milofly does not have yet (`/api/dev/theme-packages/assets*`); `theme dev` also reacts to asset changes.
