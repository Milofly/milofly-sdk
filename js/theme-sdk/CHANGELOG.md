# Changelog

## 0.1.0 (unreleased)

- First version: manifest v1 types, `readThemeProject`, `writeThemeProject`, `checkManifestShape`, `canonicalJson`,
  `component-schema` validators (same source as the Milofly platform).
- `assets` (the package's own icons and fonts): `PROJECT_LAYOUT.assets|assetFiles`, `readThemeAssets`, `assetFilePath`; `readThemeProject`
  adds `assets` with each file's SHA-256, `writeThemeProject` leaves the local asset list untouched.
