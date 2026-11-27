/**
 * First Milofly app — a complete, dependency-free example (Node.js ≥ 20):
 *
 *   GET  /install              → sends the merchant to the Milofly install screen
 *   GET  /oauth/callback       → exchanges the install code for an access token
 *   POST /webhooks/milofly     → verifies and de-duplicates webhook deliveries
 *   GET  /                     → the page Milofly embeds in the store panel (App Bridge)
 *   POST /api/session          → verifies the session token and calls the Milofly API
 *
 * Code between `// @belge:<name>` and `// @belge-son` is quoted by the developer documentation.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MiloflyApiError,
  SessionTokenError,
  WebhookVerificationError,
  buildInstallUrl,
  createClient,
  exchangeCode,
  verifySessionToken,
  verifyWebhook,
} from "@milofly/app-server";
import { config } from "./config.js";
import { findInstallation, firstDelivery, removeInstallation, saveInstallation } from "./store.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
// The browser loads App Bridge straight from the installed package (see the import map in index.html).
const bridgeDir = dirname(fileURLToPath(import.meta.resolve("@milofly/app-bridge")));
const secure = config.appOrigin.startsWith("https://");
const STATE_COOKIE = "mf_install_state";

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", ...headers });
  res.end(text);
}

function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// @belge:kurulum-baglantisi
/** App-initiated install: a random state in a cookie, the same state in the install URL. */
function startInstall(res: ServerResponse) {
  const state = randomBytes(32).toString("hex");
  const url = buildInstallUrl({
    environment: config.environment,
    appKey: config.appKey,
    clientId: config.clientId,
    state,
  });
  res.writeHead(302, {
    Location: url,
    "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/oauth; Max-Age=900; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  });
  res.end();
}
// @belge-son

// @belge:kod-takasi
/**
 * Milofly returns to your registered redirect URI with `code` (and `state` when YOU started the install;
 * an install started from the Milofly app store arrives without state). The code is single-use and only
 * your client secret can redeem it.
 */
async function finishInstall(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.searchParams.get("error") === "access_denied") return send(res, 200, "Installation cancelled.");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) return send(res, 400, "Missing code.");
  if (state !== null) {
    const expected = cookie(req, STATE_COOKIE);
    if (!expected || !sameText(state, expected)) return send(res, 403, "Install state does not match.");
  }

  const grant = await exchangeCode({
    environment: config.environment,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
  });
  saveInstallation(grant); // store grant.accessToken ENCRYPTED in a real app

  // Back to the merchant's panel, straight into this app.
  const panel = new URL(`/plugins/manage/${encodeURIComponent(config.appKey)}`, config.environment.panelOrigin);
  res.writeHead(302, { Location: panel.toString(), "Set-Cookie": `${STATE_COOKIE}=; Path=/oauth; Max-Age=0` });
  res.end();
}
// @belge-son

// @belge:webhook-dogrulama
async function receiveWebhook(req: IncomingMessage, res: ServerResponse) {
  const rawBody = await readBody(req); // raw bytes: never parse and re-serialize before verifying
  let hook;
  try {
    hook = await verifyWebhook({ secret: config.signingSecret, headers: req.headers, rawBody });
  } catch (err) {
    if (err instanceof WebhookVerificationError) return send(res, 401, { error: err.code });
    throw err;
  }
  // Retries carry the same eventId: process each event once.
  if (!firstDelivery(hook.envelope.eventId)) return send(res, 200, { duplicate: true });

  const { topic, storeId, regionId, data } = hook.envelope;
  if (topic === "app.uninstalled") {
    const d = data as { scope: "region" | "store" };
    removeInstallation(storeId, regionId, d.scope);
  }
  console.log(`[webhook] ${topic} store=${storeId} region=${regionId ?? "-"} event=${hook.envelope.eventId}`);
  send(res, 200, { ok: true });
}
// @belge-son

// @belge:oturum-jetonu
/**
 * The embedded page sends its session token on every call. The token says which store, region and
 * panel user is looking at the app; verify it on every request (it lives two minutes, App Bridge renews it).
 */
async function session(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const hostOrigin = req.headers["x-milofly-host"];
  let claims;
  try {
    claims = await verifySessionToken(token, {
      secret: config.signingSecret,
      appKey: config.appKey,
      hostOrigin: typeof hostOrigin === "string" ? hostOrigin : undefined,
    });
  } catch (err) {
    if (err instanceof SessionTokenError) return send(res, 401, { error: err.code });
    throw err;
  }
  // @belge-son

  const installation = findInstallation(claims.storeId, claims.regionId);
  if (!installation) return send(res, 409, { error: "not_installed_here" });

  // @belge:api-cagrisi
  const milofly = createClient({
    environment: config.environment,
    accessToken: installation.accessToken,
    rateLimitRetry: { maxRetries: 2, maxWaitMs: 5_000 },
  });
  try {
    const context = await milofly.request<{ store: { id: number; code: string }; regions: unknown[]; scopes: string[] }>({
      method: "GET",
      path: "/api/apps/v1/context",
    });
    send(res, 200, { claims, context });
  } catch (err) {
    if (err instanceof MiloflyApiError) return send(res, 502, { error: "milofly_api", status: err.status, code: err.code });
    throw err;
  }
  // @belge-son
}

async function staticFile(res: ServerResponse, root: string, rel: string, type: string) {
  const file = normalize(join(root, rel));
  if (!file.startsWith(root) || !/\.(html|js)$/.test(file)) return send(res, 404, "Not found");
  let content: Buffer;
  try {
    content = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return send(res, 404, "Not found");
    throw err;
  }
  res.writeHead(200, { "Content-Type": type });
  res.end(content);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", config.appOrigin);
  const route = `${req.method} ${url.pathname}`;
  const run = async () => {
    // The panel frames this app: allow ONLY the Milofly panel origin as a parent (never X-Frame-Options).
    res.setHeader("Content-Security-Policy", `frame-ancestors ${config.environment.panelOrigin}`);
    if (route === "GET /install") return startInstall(res);
    if (route === "GET /oauth/callback") return finishInstall(req, res, url);
    if (route === "POST /webhooks/milofly") return receiveWebhook(req, res);
    if (route === "POST /api/session") return session(req, res);
    if (route === "GET /") return staticFile(res, publicDir, "index.html", "text/html; charset=utf-8");
    if (route === "GET /app.js") return staticFile(res, publicDir, "app.js", "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname.startsWith("/vendor/app-bridge/"))
      return staticFile(res, bridgeDir, url.pathname.slice("/vendor/app-bridge/".length), "text/javascript; charset=utf-8");
    send(res, 404, "Not found");
  };
  run().catch((err: unknown) => {
    console.error(`[error] ${route}`, err);
    if (!res.headersSent) send(res, 500, { error: "internal" });
  });
});

server.listen(config.port, () => console.log(`First Milofly app listening on ${config.appOrigin} (port ${config.port})`));
