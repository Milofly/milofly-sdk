/**
 * HMAC helpers on Web Crypto (Node ≥ 20, Deno, Bun, edge runtimes). Signatures are compared with
 * `crypto.subtle.verify`, which is constant-time; no string equality on secrets or signatures.
 */

const encoder = new TextEncoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("@milofly/app-server needs Web Crypto (globalThis.crypto.subtle). Use Node.js 20 or newer.");
  return s;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return subtle().importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Lower-case hex → bytes. `null` when the text is not even-length hex. */
export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of view) out += b.toString(16).padStart(2, "0");
  return out;
}

/** HMAC-SHA256 as lower-case hex. */
export async function hmacSha256Hex(secret: string, data: Uint8Array): Promise<string> {
  const sig = await subtle().sign("HMAC", await hmacKey(secret, "sign"), data as BufferSource);
  return bytesToHex(sig);
}

/** Constant-time check of a hex HMAC-SHA256 signature. */
export async function verifyHmacSha256Hex(secret: string, data: Uint8Array, signatureHex: string): Promise<boolean> {
  const sig = hexToBytes(signatureHex);
  if (!sig || sig.length !== 32) return false;
  return subtle().verify("HMAC", await hmacKey(secret, "verify"), sig as BufferSource, data as BufferSource);
}

/**
 * Identifier of a signing secret, sent by Milofly as `X-Milofly-Key-Id` (webhooks) and `Kid`
 * (session tokens). Derived from the secret itself, so it changes when the secret is rotated and
 * both sides compute it without any registry: first 16 hex characters of
 * HMAC-SHA256(key = secret, message = "milofly-key-id-v1"). It reveals nothing about the secret.
 */
export async function signingKeyId(secret: string): Promise<string> {
  return (await hmacSha256Hex(secret, utf8(KEY_ID_DOMAIN))).slice(0, 16);
}

export const KEY_ID_DOMAIN = "milofly-key-id-v1";

/**
 * Chooses the secrets to try. With a key id, only the matching secret (none → `null`); without one
 * (older deliveries), every configured secret in order.
 */
export async function secretsFor(secrets: readonly string[], keyId: string | null): Promise<readonly string[] | null> {
  if (keyId === null) return secrets;
  for (const s of secrets) if ((await signingKeyId(s)) === keyId) return [s];
  return null;
}

export function normalizeSecrets(secret: string | readonly string[]): readonly string[] {
  const list = typeof secret === "string" ? [secret] : [...secret];
  if (list.length === 0 || list.some((s) => typeof s !== "string" || s.length === 0))
    throw new TypeError("secret must be a non-empty string or a non-empty list of non-empty strings.");
  return list;
}
