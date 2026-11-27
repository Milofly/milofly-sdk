# First Milofly app (Node.js)

A complete app in one small server, no framework: install (OAuth), webhooks, an embedded page in the
Milofly store panel (App Bridge) and a call to the Milofly API.

| Route | What it shows |
|---|---|
| `GET /install` | Start an install from your side (`buildInstallUrl`, CSRF state in a cookie). |
| `GET /oauth/callback` | Redeem the install code (`exchangeCode`), store the installation, return to the panel. |
| `POST /webhooks/milofly` | Verify the signature on the raw body (`verifyWebhook`), process each `eventId` once. |
| `GET /` | The page the panel embeds (`createApp` from `@milofly/app-bridge`, loaded through an import map). |
| `POST /api/session` | Verify the session token (`verifySessionToken`) and call `GET /api/apps/v1/context`. |

## Run

1. In the developer portal: create an app, set
   - **App URL** → `APP_ORIGIN` (the panel frames this page),
   - **Redirect URL** → `APP_ORIGIN/oauth/callback`,
   - **Webhook URL** → `APP_ORIGIN/webhooks/milofly` (public https; use a tunnel while developing),
   - add your test store.
2. Configure (all required; the app refuses to start without them):

   ```
   MILOFLY_ENVIRONMENT=production          # or "custom" + MILOFLY_API_BASE_URL + MILOFLY_PANEL_ORIGIN
   MILOFLY_APP_KEY=app.yourcompany.first
   MILOFLY_CLIENT_ID=...
   MILOFLY_CLIENT_SECRET=...
   MILOFLY_SIGNING_SECRET=...              # webhook signing secret; also signs session tokens
   APP_ORIGIN=https://first-app.example.com
   PORT=3000
   ```
3. `npm install && npm run build && npm start`
4. Open `APP_ORIGIN/install` (or install from the Milofly app store in your test store).

## Notes

- Installations and processed event ids live in memory here. Keep them in your database, with the access
  token encrypted.
- The server sends `Content-Security-Policy: frame-ancestors <panel origin>`: only the Milofly panel may
  frame the page. Do not add `X-Frame-Options`.
- Every request from the embedded page carries a fresh session token; verify it on every request. The
  store, region and panel user come from the token, never from the page.
