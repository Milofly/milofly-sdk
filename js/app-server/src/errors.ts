/** Webhook request rejected. `code` is stable; answer the request with 401 and do not process it. */
export class WebhookVerificationError extends Error {
  readonly code:
    | "missing_header"
    | "malformed_header"
    | "timestamp_out_of_range"
    | "unknown_key"
    | "signature_mismatch"
    | "body_invalid"
    | "envelope_mismatch";
  constructor(code: WebhookVerificationError["code"], message?: string) {
    super(message ?? code);
    this.name = "WebhookVerificationError";
    this.code = code;
  }
}

/** Session token rejected. `code` is stable; treat the request as unauthenticated. */
export class SessionTokenError extends Error {
  readonly code:
    | "malformed"
    | "unknown_key"
    | "signature_mismatch"
    | "unsupported_version"
    | "app_mismatch"
    | "expired"
    | "not_yet_valid"
    | "host_origin_mismatch";
  constructor(code: SessionTokenError["code"], message?: string) {
    super(message ?? code);
    this.name = "SessionTokenError";
    this.code = code;
  }
}

/**
 * Non-success answer of the Milofly API (HTTP status outside 2xx, or `success: false`).
 * `code`/`params` come from the API error envelope; `code` is `null` when the API sent none.
 */
export class MiloflyApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly params: Record<string, unknown> | null;
  readonly body: unknown;
  readonly retryAfterSeconds: number | null;
  constructor(init: { status: number; code: string | null; params: Record<string, unknown> | null; message: string; body: unknown; retryAfterSeconds: number | null }) {
    super(init.message);
    this.name = "MiloflyApiError";
    this.status = init.status;
    this.code = init.code;
    this.params = init.params;
    this.body = init.body;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}
