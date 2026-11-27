# @milofly/cli

The Milofly developer CLI. Sign in with your browser, develop composition themes against your development store, and
scaffold apps.

```
npm install -g @milofly/cli
milofly login
milofly theme init my-theme
cd my-theme
milofly theme dev
```

| Command | What it does |
|---|---|
| `milofly login` | Shows a short code and opens the developer portal; you confirm there. No password in the terminal. The session is kept in your OS keychain (Windows DPAPI, macOS Keychain, Linux Secret Service). |
| `milofly logout` / `whoami` | Close the session / show the developer and publisher key. |
| `milofly theme init [dir]` | Pick a development store and a theme in it, create the project and pull it. |
| `milofly theme pull` | Bring the theme from your development store into `theme/` (your local version and catalog texts are kept). |
| `milofly theme check` | Validate with the Milofly rules: release, install, publishing to all stores. Exit code 1 if it cannot be released or installed. |
| `milofly theme dev` | On every change: a draft development release (`x.y.z-dev.<time>`), installed and published in your development store; the previous development install is removed. |
| `milofly theme push [--activate]` | Write the version in `theme/package.json` as a draft release and install it in your development store. |
| `milofly theme pack` | Write `dist/<package>-<version>.json` (no upload). |
| `milofly theme submit` | Send a pushed version to Milofly review. |
| `milofly theme list [--all]` | Your packages and releases. |
| `milofly app init <dir>` | Start an app from the first-app template (install, webhooks, embedded page, API call). |

Only your own development stores are ever written to. Docs: https://developer.milofly.com/docs/cli

Requires Node.js 20 or newer. Depends only on `@milofly/theme-sdk`.
