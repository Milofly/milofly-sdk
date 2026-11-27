import { MiloflyApiError } from "./errors.js";
import type { MiloflyEnvironment } from "./environments.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryValue = string | number | boolean | null | undefined | readonly (string | number | boolean)[];

export interface RequestOptions {
  method: HttpMethod;
  /** Full API path, e.g. `/api/apps/v1/products`. Path parameters already substituted. */
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /**
   * Region to act on. Store-wide installations must pin a region on most endpoints; region
   * installations are locked to their own region (sending another one is refused by the API).
   */
  regionId?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface RateLimitRetry {
  /** How many times a 429 is retried. */
  maxRetries: number;
  /** Largest `Retry-After` the client is willing to wait (ms); a longer one fails immediately. */
  maxWaitMs: number;
}

export interface ClientOptions {
  environment: Pick<MiloflyEnvironment, "apiBaseUrl">;
  /** Access token from the install (`exchangeCode`). */
  accessToken: string;
  /** Region used when a request does not set one. */
  regionId?: number;
  /** `false`: a 429 fails at once. Otherwise the client waits `Retry-After` within these bounds. */
  rateLimitRetry: RateLimitRetry | false;
  fetch?: typeof fetch;
}

export interface MiloflyClient {
  request<T = unknown>(options: RequestOptions): Promise<T>;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (raw === null) return null;
  if (/^[0-9]+$/.test(raw.trim())) return Number(raw.trim());
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** Builds a {@link MiloflyApiError} from a non-success response and its parsed body. */
export function readApiError(res: Response, body: unknown): MiloflyApiError {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const code = typeof rec?.code === "string" && rec.code.length > 0 ? rec.code : null;
  const params = rec?.params && typeof rec.params === "object" && !Array.isArray(rec.params) ? (rec.params as Record<string, unknown>) : null;
  const message = typeof rec?.message === "string" && rec.message.length > 0 ? rec.message : `Milofly API responded ${res.status}${code ? ` (${code})` : ""}.`;
  return new MiloflyApiError({ status: res.status, code, params, message, body, retryAfterSeconds: retryAfterSeconds(res) });
}

function appendQuery(url: URL, query: Record<string, QueryValue> | undefined) {
  if (!query) return;
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
    else url.searchParams.set(k, String(v));
  }
}

/**
 * Minimal authenticated client for `/api/apps/**`. Typed operations are generated on top of it.
 *
 * - Every non-2xx answer, and every 2xx answer with `success: false`, throws {@link MiloflyApiError}.
 * - 429 is retried only within {@link RateLimitRetry}; nothing is retried silently beyond it.
 */
export function createClient(options: ClientOptions): MiloflyClient {
  if (!options.accessToken) throw new TypeError("accessToken is required.");
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    async request<T>(req: RequestOptions): Promise<T> {
      if (!req.path.startsWith("/api/apps/")) throw new TypeError(`path must start with /api/apps/ (got ${req.path}).`);
      const url = new URL(req.path, options.environment.apiBaseUrl);
      appendQuery(url, req.query);
      const regionId = req.regionId ?? options.regionId;
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${options.accessToken}`,
        ...(regionId !== undefined ? { "X-Region-Id": String(regionId) } : {}),
        ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...req.headers,
      };
      const init: RequestInit = {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: req.signal,
      };

      for (let attempt = 0; ; attempt++) {
        const res = await doFetch(url, init);
        const text = await res.text();
        let body: unknown = null;
        if (text.length > 0) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        if (res.status === 429 && options.rateLimitRetry && attempt < options.rateLimitRetry.maxRetries) {
          const wait = retryAfterSeconds(res);
          if (wait !== null && wait * 1000 <= options.rateLimitRetry.maxWaitMs) {
            await sleep(wait * 1000, req.signal);
            continue;
          }
        }
        if (!res.ok) throw readApiError(res, body);
        if (body && typeof body === "object" && (body as { success?: unknown }).success === false) throw readApiError(res, body);
        return body as T;
      }
    },
  };
}
