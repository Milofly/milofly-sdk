import { normalizeSecrets, signingKeyId, utf8, verifyHmacSha256Hex } from "./crypto.js";
import { SessionTokenError } from "./errors.js";

/** Domain prefix of the signed string; a webhook signature can never be valid here (and vice versa). */
export const SESSION_TOKEN_DOMAIN = "milofly-embed-v1";

/** Tolerance for tokens issued slightly in the future (clock skew between Milofly and your server). */
export const SESSION_TOKEN_CLOCK_SKEW_SECONDS = 60;

/**
 * Claims of a verified session token. Issued by Milofly for the merchant who opened your app; the
 * panel refreshes it every couple of minutes over App Bridge.
 */
export interface SessionTokenClaims {
  appKey: string;
  storeId: number;
  /** Region the panel is on. */
  regionId: number | null;
  storeCode: string | null;
  /** Installation scope: one region, or the whole store. */
  scope: "region" | "store";
  issuedAt: number;
  expiresAt: number;
  /** Panel user (identity id) who is viewing the app. Newer tokens only. */
  userId: number | null;
  /** Unique token id. Newer tokens only. */
  tokenId: string | null;
  /** Origin of the panel the token was issued to. Newer tokens only. */
  hostOrigin: string | null;
  /** Panel surface the token was issued for (`fullpage`, `order-detail`, …). Newer tokens only. */
  surface: string | null;
  /** Id of the secret that signed the token. Newer tokens only. */
  keyId: string | null;
}

export interface VerifySessionTokenOptions {
  /** Your app's signing secret(s) — the same secret that signs your webhooks. */
  secret: string | readonly string[];
  /** Your app key. A token issued for another app is refused. */
  appKey: string;
  /**
   * The host origin your frame talked to (`app.hostOrigin` on the client). When given, the token
   * must carry the same `HostOrigin`: a token issued to the real panel is refused if your frame was
   * opened by another page.
   */
  hostOrigin?: string;
  /** Unix seconds; defaults to the current time. */
  now?: number;
}

function b64urlDecode(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/**
 * Verifies a session token (`base64url(claims).hex(HMAC-SHA256(secret, "milofly-embed-v1\n" + body))`).
 * The signature is checked before the body is parsed. Throws {@link SessionTokenError}.
 */
export async function verifySessionToken(token: string, options: VerifySessionTokenOptions): Promise<SessionTokenClaims> {
  const secrets = normalizeSecrets(options.secret);
  if (typeof token !== "string") throw new SessionTokenError("malformed");
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".") || dot === token.length - 1) throw new SessionTokenError("malformed");
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  // Signature FIRST, body after: unverified input is never parsed. Every configured secret is tried
  // (one, or two during a rotation); the claimed key id is then checked against the secret that matched.
  const signed = utf8(`${SESSION_TOKEN_DOMAIN}\n${body}`);
  let signer: string | null = null;
  for (const s of secrets) {
    if (await verifyHmacSha256Hex(s, signed, signature.toLowerCase())) {
      signer = s;
      break;
    }
  }
  if (signer === null) throw new SessionTokenError("signature_mismatch");

  const decoded = b64urlDecode(body);
  if (decoded === null) throw new SessionTokenError("malformed");
  let claims: Record<string, unknown>;
  try {
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    claims = parsed as Record<string, unknown>;
  } catch {
    throw new SessionTokenError("malformed");
  }
  const keyId = str(claims.Kid);
  if (keyId !== null && keyId !== (await signingKeyId(signer))) throw new SessionTokenError("unknown_key");

  if (claims.V !== 1) throw new SessionTokenError("unsupported_version");
  const appKey = str(claims.AppKey);
  const storeId = int(claims.StoreId);
  const iat = int(claims.Iat);
  const exp = int(claims.Exp);
  const scope = claims.Scope;
  if (appKey === null || storeId === null || storeId <= 0 || iat === null || exp === null || (scope !== "region" && scope !== "store"))
    throw new SessionTokenError("malformed");
  if (appKey !== options.appKey) throw new SessionTokenError("app_mismatch");

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (now > exp) throw new SessionTokenError("expired");
  if (iat > now + SESSION_TOKEN_CLOCK_SKEW_SECONDS) throw new SessionTokenError("not_yet_valid");

  const hostOrigin = str(claims.HostOrigin);
  if (options.hostOrigin !== undefined && hostOrigin !== options.hostOrigin) throw new SessionTokenError("host_origin_mismatch");

  return {
    appKey,
    storeId,
    regionId: int(claims.RegionId),
    storeCode: str(claims.StoreCode),
    scope,
    issuedAt: iat,
    expiresAt: exp,
    userId: int(claims.Sub),
    tokenId: str(claims.Jti),
    hostOrigin,
    surface: str(claims.Surface),
    keyId,
  };
}
