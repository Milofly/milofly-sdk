# @milofly/app-server

Server-side helpers for Milofly apps. Zero dependencies; runs on Node.js ≥ 20, Deno, Bun and edge runtimes (Web Crypto + fetch).

```
npm install @milofly/app-server
```

| Function | Purpose |
|---|---|
| `verifyWebhook` | Verify `X-Milofly-Hmac-Sha256` (topic, store and timestamp are signed), the 5-minute replay window, and return the envelope (`eventId` for de-duplication). |
| `verifySessionToken` | Verify the session token your embedded page got from App Bridge; returns store, region, panel user (`userId`), surface and host origin. |
| `buildInstallUrl` | URL of the install (consent) screen for a merchant. |
| `exchangeCode` | Install code → access token (server only, needs the client secret). |
| `createClient` | Authenticated client for `/api/apps/**` (typed operations are generated from the published OpenAPI document). |
| `signingKeyId` | Id of a signing secret; matches `X-Milofly-Key-Id` / the token's `Kid`. |

There is no implicit environment: pass `MILOFLY_ENVIRONMENTS.production` or your own `{ apiBaseUrl, panelOrigin }`.

```ts
import { verifyWebhook, WebhookVerificationError } from "@milofly/app-server";

app.post("/webhooks/milofly", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const { envelope } = await verifyWebhook({ secret: process.env.MILOFLY_WEBHOOK_SECRET!, headers: req.headers, rawBody: req.body });
    if (await alreadyProcessed(envelope.eventId)) return res.sendStatus(200);
    await handle(envelope);
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return res.sendStatus(401);
    throw err;
  }
});
```

Always pass the raw body. Parsing and re-serializing JSON changes the bytes and breaks the signature.

Pass a list of secrets (`[current, previous]`) during a secret rotation: the `X-Milofly-Key-Id` header / `Kid`
claim selects the matching one.
