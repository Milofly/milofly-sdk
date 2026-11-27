# @milofly/theme-sdk

Types and helpers for Milofly **composition theme packages** (manifest v1). A Milofly theme is data, not code: pages,
layouts and theme settings built from Milofly's component library, plus the *offerings* (which components, product cards,
modals and badges the theme provides). You build it visually in your development store; this SDK keeps it as a reviewable
folder. The `milofly` CLI (`@milofly/cli`) uses it.

```
npm install @milofly/theme-sdk
```

The rules (component keys, settings, offerings, store neutrality, languages, custom CSS) are enforced by the Milofly API with
the same validator that writes releases. Run `milofly theme check` to ask it.

## Project layout

```
theme/package.json        packageKey, version, languages, catalog name/description per language
theme/theme.json          category, thumbnailUrl, …
theme/pages/<page>.json   one file per system page (components in order)
theme/layouts.json        header, footer, popup
theme/settings/<key>.json theme settings (theme_config, badge_config, modal_config, …)
theme/offerings.json      what the theme offers (surfaces)
```

```js
import { readThemeProject, writeThemeProject, checkManifestShape } from "@milofly/theme-sdk";

const manifest = await readThemeProject(".");          // one manifest object
console.log(checkManifestShape(manifest));            // local type check only
await writeThemeProject(".", manifest);                // stable JSON, one file per page/setting
```

## Component schema contract

`@milofly/theme-sdk/component-schema` exposes the validators Milofly runs on its own components' `schema.json`
(language coverage, schema fragments, dynamic field declarations). Uploading your own code components is not open yet.

Requires Node.js 20 or newer. No runtime dependencies.
