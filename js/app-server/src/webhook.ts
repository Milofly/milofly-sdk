import { concatBytes, normalizeSecrets, secretsFor, utf8, verifyHmacSha256Hex } from "./crypto.js";
import { WebhookVerificationError } from "./errors.js";

/** Headers Milofly sends with every webhook delivery. */
export const WebhookHeader = {
  Signature: "x-milofly-hmac-sha256",
  Topic: "x-milofly-topic",
  Store: "x-milofly-store",
  Timestamp: "x-milofly-timestamp",
  /** Identifier of the secret that signed the delivery (see `signingKeyId`). Absent on older deliveries. */
  KeyId: "x-milofly-key-id",
} as const;

/**
 * Replay window. Milofly signs each delivery attempt with a fresh timestamp, so a retried delivery is
 * never outside this window; anything older (or this far in the future) is refused.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Webhook envelope shared by every topic. `data` is topic specific. */
export interface WebhookEnvelope<TData = unknown> {
  version: string;
  topic: string;
  storeId: number;
  regionId: number | null;
  /** Stable per event: store it and ignore a second delivery with the same id. */
  eventId: string;
  occurredAt: string;
  data: TData;
}

export interface VerifiedWebhook<TData = unknown> {
  topic: string;
  storeId: number;
  timestamp: number;
  keyId: string | null;
  envelope: WebhookEnvelope<TData>;
}

/** Plain header map (Node `IncomingHttpHeaders`, Express `req.headers`) or a Fetch `Headers`. */
export type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function header(source: HeaderSource, name: string): string | null {
  if (typeof (source as Headers).get === "function") return (source as Headers).get(name);
  const record = source as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value ?? null;
}

const INTEGER = /^-?[0-9]{1,19}$/;

export interface VerifyWebhookOptions {
  /** Webhook signing secret(s) of your app. Pass the previous one too while a rotation is in progress. */
  secret: string | readonly string[];
  headers: HeaderSource;
  /**
   * The request body EXACTLY as received (string or bytes). Do not parse and re-serialize it:
   * whitespace or key order changes break the signature.
   */
  rawBody: string | Uint8Array;
  /** Unix seconds; defaults to the current time. */
  now?: number;
  toleranceSeconds?: number;
}

/**
 * Verifies a Milofly webhook delivery and returns its envelope.
 *
 * Signature: `HMAC-SHA256(secret, "{topic}\n{storeId}\n{timestamp}\n{body}")`, lower-case hex, in
 * `X-Milofly-Hmac-Sha256`. Topic, store and timestamp are inside the signature, so none of the
 * headers can be swapped. Throws {@link WebhookVerificationError}; never returns an unverified body.
 */
export async function verifyWebhook<TData = unknown>(options: VerifyWebhookOptions): Promise<VerifiedWebhook<TData>> {
  const secrets = normalizeSecrets(options.secret);
  const signature = header(options.headers, WebhookHeader.Signature);
  const topic = header(options.headers, WebhookHeader.Topic);
  const storeHeader = header(options.headers, WebhookHeader.Store);
  const tsHeader = header(options.headers, WebhookHeader.Timestamp);
  const keyId = header(options.headers, WebhookHeader.KeyId);
  if (!signature || !topic || !storeHeader || !tsHeader) throw new WebhookVerificationError("missing_header");
  if (!INTEGER.test(storeHeader) || !INTEGER.test(tsHeader)) throw new WebhookVerificationError("malformed_header");

  const timestamp = Number(tsHeader);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) throw new WebhookVerificationError("timestamp_out_of_range");

  const candidates = await secretsFor(secrets, keyId);
  if (candidates === null) throw new WebhookVerificationError("unknown_key", `No configured secret has key id ${keyId}.`);

  const body = typeof options.rawBody === "string" ? utf8(options.rawBody) : options.rawBody;
  const signed = concatBytes(utf8(`${topic}\n${storeHeader}\n${tsHeader}\n`), body);
  let valid = false;
  for (const s of candidates) {
    if (await verifyHmacSha256Hex(s, signed, signature.trim())) {
      valid = true;
      break;
    }
  }
  if (!valid) throw new WebhookVerificationError("signature_mismatch");

  let envelope: WebhookEnvelope<TData>;
  try {
    envelope = JSON.parse(typeof options.rawBody === "string" ? options.rawBody : new TextDecoder().decode(options.rawBody)) as WebhookEnvelope<TData>;
  } catch {
    throw new WebhookVerificationError("body_invalid");
  }
  if (!envelope || typeof envelope !== "object" || typeof envelope.eventId !== "string") throw new WebhookVerificationError("body_invalid");
  // The body is signed too, but it must also agree with the signed headers.
  if (envelope.topic !== topic || String(envelope.storeId) !== storeHeader) throw new WebhookVerificationError("envelope_mismatch");

  return { topic, storeId: Number(storeHeader), timestamp, keyId, envelope };
}
