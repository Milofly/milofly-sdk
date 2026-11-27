# Contributing

Thank you for helping improve the Milofly SDKs.

## Issues

- Bugs and feature requests: https://github.com/Milofly/milofly-sdk/issues. Please include the package and version,
  your runtime (Node.js, Deno, Bun or .NET version) and the smallest code that reproduces the problem.
- Security vulnerabilities: do not open an issue, see [SECURITY.md](SECURITY.md).
- Questions about the Milofly API, scopes, webhooks or the developer portal: https://developer.milofly.com

## Pull requests

This repository is published from the Milofly platform repository, where the SDKs are developed together with the API
they talk to. Pull requests are welcome: maintainers review them here and apply accepted changes upstream, so the
change reaches this repository with the next export. Keep each pull request to one change.

- Keep the packages free of runtime dependencies.
- Do not add defaults or fallbacks the Milofly API does not define; a missing or invalid value is an error.
- Do not edit files under `shared/`: they are copies of platform contracts.
- Update the package's `CHANGELOG.md`.

Before opening a pull request:

```
npm install
npm run typecheck
node scripts/yayin.mjs            # dry-run release, nothing is uploaded
dotnet build dotnet/Milofly.Apps.sln
```

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
