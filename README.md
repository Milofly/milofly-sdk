# Milofly SDK

The command-line tool and the SDKs for building on [Milofly](https://developer.milofly.com): composition themes for
Milofly stores, and apps that install into a store, receive webhooks, run inside the Milofly store panel and call the
Milofly API.

Developer portal and documentation: **https://developer.milofly.com** (CLI: https://developer.milofly.com/docs/cli).

| Package | Folder | Runs on | What it is |
|---|---|---|---|
| [`@milofly/cli`](js/cli) | `js/cli` | Node.js ≥ 20 | The `milofly` command: browser sign-in, `theme init/pull/check/dev/push/pack/submit/list`, `app init` |
| [`@milofly/app-bridge`](js/app-bridge) | `js/app-bridge` | browser | Embedded app client (`createApp`), the bridge message contract (`/contract`), the panel's host engine (`/host`) |
| [`@milofly/app-server`](js/app-server) | `js/app-server` | Node.js ≥ 20, Deno, Bun, edge | Webhook and session token verification, install (OAuth) helpers, `/api/apps` client |
| [`@milofly/theme-sdk`](js/theme-sdk) | `js/theme-sdk` | Node.js ≥ 20 | Theme package manifest types, project layout (read/write), component schema validators (`/component-schema`) |
| [`Milofly.Apps`](dotnet/Milofly.Apps) | `dotnet/Milofly.Apps` | .NET 8+ | The app server helpers for .NET |

All packages have zero runtime dependencies (Web Crypto + fetch; only the BCL on .NET), except that `@milofly/cli`
depends on `@milofly/theme-sdk`.

## Install

```
npm install -g @milofly/cli          # the milofly command
npm install @milofly/app-server      # server side of an app
npm install @milofly/app-bridge      # embedded page of an app
npm install @milofly/theme-sdk       # theme tooling in your own scripts
dotnet add package Milofly.Apps      # .NET apps
```

## Quick start

A theme, developed against your own development store:

```
milofly login
milofly theme init my-theme
cd my-theme
milofly theme dev
```

An app, from the first-app template (install, webhooks, embedded page, API call):

```
milofly app init my-app
cd my-app
npm install && npm run build
```

Then create the app in the developer portal and set the environment variables listed in the app's README. The template
is the example in [`ornekler/ilk-uygulama`](ornekler/ilk-uygulama).

## Principles

- The SDKs are clients of the Milofly API contract. They do not invent rules or defaults: the environment
  (`MILOFLY_ENVIRONMENTS.production` or your own endpoints) is chosen explicitly, and a missing or mismatched field is an error.
- The bridge message contract has one owner: `js/app-bridge/src/contract.ts`. The Milofly panel consumes the host side from it.
- `@milofly/theme-sdk` validates components with the same rules as the Milofly platform. Those contract files are copied
  into [`shared/`](shared) from the platform and must not be edited here.

## Contributing and security

- Bugs and feature requests: https://github.com/Milofly/milofly-sdk/issues
- How to work in this repository: [CONTRIBUTING.md](CONTRIBUTING.md)
- Reporting a vulnerability: [SECURITY.md](SECURITY.md) (please do not open a public issue)
- Changes per release: [CHANGELOG.md](CHANGELOG.md) and each package's `CHANGELOG.md`

## Maintainers

Source `package.json` files always stay `"private": true` and carry no license or addresses: the license, `repository`,
`homepage` and `bugs` live in one place, [`scripts/yayin-ayari.json`](scripts/yayin-ayari.json) (the .NET project reads
the same file). `scripts/paketle.mjs <package>` builds the publish folder `js/<package>/dist/` (code, README, CHANGELOG,
LICENSE and the publish `package.json`); `scripts/yayin.mjs` does it for the four packages in release order
(`theme-sdk` → `app-bridge` → `app-server` → `cli`). Internal dependencies (`cli` → `theme-sdk`, the app template →
`app-bridge`/`app-server`) are pinned to the sibling package's version, and packing stops on a mismatch.

```
npm install                                    # workspace root (TypeScript, @types/node)
npm run typecheck                              # app-bridge, app-server, theme-sdk (.d.ts only; the package is JavaScript)
node scripts/yayin.mjs                         # dry run: build the four packages + npm publish --dry-run, nothing is uploaded
node scripts/paketle.mjs app-server            # one package's publish folder
node js/cli/src/milofly.mjs --help             # run the CLI from source
dotnet build dotnet/Milofly.Apps.sln
dotnet pack dotnet/Milofly.Apps/Milofly.Apps.csproj -c Release -o <out>
```

Releases run from GitHub Actions ([`.github/workflows/sdk-yayin.yml`](.github/workflows/sdk-yayin.yml)) on a version tag
(`v0.1.0`) that equals every package's version:

- **npm** uses [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no stored token, provenance added
  by npm). Each npm package names `Milofly/milofly-sdk` and the workflow file `sdk-yayin.yml` as its trusted publisher.
- **NuGet** uses [trusted publishing](https://learn.microsoft.com/nuget/nuget-org/trusted-publishing) through
  `NuGet/login`: a nuget.org trusted publishing policy for `Milofly/milofly-sdk` and `sdk-yayin.yml`, and the repository
  secret `NUGET_USER` (the nuget.org profile name). No NuGet API key is stored.
- Before any upload the workflow checks that the root and package `CHANGELOG.md` files have a dated `## <version>`
  heading (`node scripts/surum-notu.mjs <version>`). A version that is already published is skipped, never overwritten,
  so re-running the workflow finishes a release that stopped half-way.

Every release:

1. Set the same version in the four `js/<package>/package.json` files and in `dotnet/Milofly.Apps/Milofly.Apps.csproj`.
2. Replace `(unreleased)` with the release date in `CHANGELOG.md` and in each `js/<package>/CHANGELOG.md`.
3. Commit, then push the tag `v<version>`.

The first release (0.1.0) only: npm shows the trusted publisher settings only for a package that already exists, so do
steps 1–2 and then, in this order:

1. A maintainer publishes the four npm packages once from their machine: `npm login` (2FA), then
   `node scripts/yayin.mjs --yayimla`.
2. On npmjs.com, set `Milofly/milofly-sdk` + `sdk-yayin.yml` as the trusted publisher of each of the four packages.
   On nuget.org, create the trusted publishing policy, and add the repository secret `NUGET_USER`.
3. Push the tag `v0.1.0`. The npm job finds the four packages already published and skips them; the NuGet job publishes
   `Milofly.Apps` 0.1.0.

Every push and pull request runs [`.github/workflows/sdk-denetim.yml`](.github/workflows/sdk-denetim.yml): type check,
dry-run release, the `app init` template installed from the packed packages and built, and the .NET build and pack.

## License

[MIT](LICENSE)
