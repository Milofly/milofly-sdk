# @milofly/app-bridge

Embed your app in the Milofly store panel.

```
npm install @milofly/app-bridge
```

- `@milofly/app-bridge` — client for your embedded page (`createApp`).
- `@milofly/app-bridge/contract` — the message contract (types, limits, validators). Both the panel and your app consume it.
- `@milofly/app-bridge/host` — the host engine used by the Milofly panel. Apps do not need it.

## Quick start

```ts
import { createApp, MiloflyBridgeError } from "@milofly/app-bridge";

const app = await createApp({ allowedHostOrigins: ["https://app.milofly.com"] });

// Identity: send the session token to YOUR server and verify it there
// (@milofly/app-server → verifySessionToken, or Milofly.Apps → SessionTokenVerifier).
const token = await app.getSessionToken();

if (app.supports("toast")) await app.toast("Settings saved", { tone: "success" });
if (app.initialPath) router.go(app.initialPath);          // reload / deep link of a full-page app
router.onChange((path) => app.navigate(path));             // the panel URL follows your app
```

`createApp` reads `mf_host` from the frame URL, removes `embed_token` from the address bar, sends
`milofly:ready` and waits for `milofly:init`. Everything in `app` (store, locale, surface) is
informational; authorization is what your server reads from the verified token.

## Messages (contract v2)

| Direction | Message | Notes |
|---|---|---|
| app → host | `milofly:ready` | Host answers with `init` every time. |
| host → app | `milofly:init` | `contractVersion`, `pluginKey`, `uiLocale`, `contentLocale`, `surface`, `entity`, `storeContext`, `hostOrigin`, `hostCapabilities`, `path`. |
| app → host | `milofly:resize` | Content height; ignored on full-page surfaces. |
| app → host | `milofly:token-request` | Answered with `milofly:token` or `milofly:token-error` (`reason` = access reason code). |
| app → host | `milofly:toast` `title` `navigate` `redirect` `open` `confirm` `loading` | Answered with `milofly:result {requestId, ok, data?, error?}`. `error`: `unsupported`, `invalid`, `denied`, `failed`. |

Limits and validation rules are in `contract.ts` (`LIMITS`, `parseAppMessage`); the host enforces them.

## Security

- The client talks only to the `mf_host` origin and only to `window.parent`; the host talks only to your
  app origin and only to your frame window. `"*"` is never used.
- Pass `allowedHostOrigins` in production.
- The session token lives 2 minutes. `getSessionToken()` refreshes it through the host 30 seconds before expiry.
