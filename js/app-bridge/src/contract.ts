/**
 * Milofly App Bridge — host ↔ embedded app message contract (single source).
 *
 * Both ends consume this file: the Milofly store panel (host, via `@milofly/app-bridge/host`)
 * and every embedded app (via `createApp` from `@milofly/app-bridge`). A message that is not
 * described here does not exist; a field that is not validated here is not accepted.
 *
 * Versioning: v1 messages (`ready`, `init`, `resize`, `token-request`, `token`, `token-error`)
 * keep their shape, so apps written against v1 keep working. v2 adds host actions
 * (`toast`, `title`, `navigate`, `redirect`, `open`, `confirm`, `loading`) answered with
 * `result`, plus extra `init` fields. A breaking change bumps {@link CONTRACT_VERSION}.
 */

/** Current contract version, sent by the host in `milofly:init.contractVersion`. */
export const CONTRACT_VERSION = 2;

/** Every message type on the wire. */
export const MessageType = {
  /** app → host: the app is listening; host answers with `init` (every time). */
  Ready: "milofly:ready",
  /** host → app: context of this frame. */
  Init: "milofly:init",
  /** app → host: content height in CSS px (ignored on full-page surfaces). */
  Resize: "milofly:resize",
  /** app → host: ask for a fresh session token. */
  TokenRequest: "milofly:token-request",
  /** host → app: fresh session token for a `token-request`. */
  Token: "milofly:token",
  /** host → app: no token could be issued for a `token-request` (`reason` is an access reason code). */
  TokenError: "milofly:token-error",
  /** app → host (v2): show a toast in the panel. */
  Toast: "milofly:toast",
  /** app → host (v2): set the page title shown by the panel. */
  Title: "milofly:title",
  /** app → host (v2): the app moved to another in-app path; the panel mirrors it in its own URL. */
  Navigate: "milofly:navigate",
  /** app → host (v2): open a panel resource (order/product/customer detail). */
  Redirect: "milofly:redirect",
  /** app → host (v2): open an external https URL in a new tab. */
  Open: "milofly:open",
  /** app → host (v2): ask the merchant to confirm; answered with `{ confirmed }`. */
  Confirm: "milofly:confirm",
  /** app → host (v2): show/hide the panel progress indicator. */
  Loading: "milofly:loading",
  /** host → app (v2): answer to a v2 request. */
  Result: "milofly:result",
} as const;
export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/** Panel surfaces where an app frame can be rendered. */
export const Surface = {
  Fullpage: "fullpage",
  OrderDetail: "order-detail",
  CustomerDetail: "customer-detail",
  ProductDetail: "product-detail",
} as const;
export type SurfaceKey = (typeof Surface)[keyof typeof Surface];
export const SURFACES: readonly SurfaceKey[] = Object.freeze(Object.values(Surface));
export function isSurface(value: unknown): value is SurfaceKey {
  return typeof value === "string" && (SURFACES as readonly string[]).includes(value);
}

/** Panel resources an app may point to (`redirect`) and detail surfaces show. */
export const Resource = {
  Order: "order",
  Customer: "customer",
  Product: "product",
} as const;
export type ResourceKey = (typeof Resource)[keyof typeof Resource];
export const RESOURCES: readonly ResourceKey[] = Object.freeze(Object.values(Resource));
export function isResource(value: unknown): value is ResourceKey {
  return typeof value === "string" && (RESOURCES as readonly string[]).includes(value);
}

/** Which resource a surface is about (`null` = the surface is not bound to one record). */
export const SURFACE_RESOURCE: Readonly<Record<SurfaceKey, ResourceKey | null>> = Object.freeze({
  [Surface.Fullpage]: null,
  [Surface.OrderDetail]: Resource.Order,
  [Surface.CustomerDetail]: Resource.Customer,
  [Surface.ProductDetail]: Resource.Product,
});

/** Host actions (v2). A host lists the ones it implements in `init.hostCapabilities`. */
export const HostCapability = {
  Toast: "toast",
  Title: "title",
  Navigate: "navigate",
  Redirect: "redirect",
  Open: "open",
  Confirm: "confirm",
  Loading: "loading",
} as const;
export type HostCapabilityKey = (typeof HostCapability)[keyof typeof HostCapability];
export const HOST_CAPABILITIES: readonly HostCapabilityKey[] = Object.freeze(Object.values(HostCapability));

/** Request message type of each host action. */
export const CAPABILITY_MESSAGE = Object.freeze({
  toast: MessageType.Toast,
  title: MessageType.Title,
  navigate: MessageType.Navigate,
  redirect: MessageType.Redirect,
  open: MessageType.Open,
  confirm: MessageType.Confirm,
  loading: MessageType.Loading,
} as const satisfies Record<HostCapabilityKey, MessageTypeValue>);

export const TOAST_TONES = Object.freeze(["info", "success", "warning", "critical"] as const);
export type ToastTone = (typeof TOAST_TONES)[number];
export const CONFIRM_TONES = Object.freeze(["default", "critical"] as const);
export type ConfirmTone = (typeof CONFIRM_TONES)[number];

/** Length limits enforced by the host (characters). */
export const LIMITS = Object.freeze({
  requestId: 128,
  toastMessage: 300,
  title: 120,
  confirmTitle: 120,
  confirmMessage: 1000,
  confirmLabel: 40,
  path: 2048,
  url: 2048,
  resourceId: 19,
});

/** Query parameters the host adds to the frame URL. */
export const UrlParam = {
  /** Short-lived signed session token (the app strips it from its address bar). */
  EmbedToken: "embed_token",
  /** Origin of the host panel. The app talks only to this origin. */
  HostOrigin: "mf_host",
  /** In-app path to open (set when the merchant reloads or deep-links a full-page app). */
  Path: "mf_path",
} as const;

/** `result.error` codes. */
export const ResultError = {
  /** The host does not implement this action. */
  Unsupported: "unsupported",
  /** The request failed validation (see {@link LIMITS} and the per-action rules). */
  Invalid: "invalid",
  /** The host refused (e.g. the merchant is not allowed to open the resource). */
  Denied: "denied",
  /** The host tried and failed. */
  Failed: "failed",
} as const;
export type ResultErrorCode = (typeof ResultError)[keyof typeof ResultError];

/** Timings of the handshake and token refresh. */
export const TIMING = Object.freeze({
  /** Host: if the app never sends `ready`, `init` is sent this long after the frame loads. */
  initFallbackMs: 1200,
  /** App: how long `createApp` waits for `init`. */
  handshakeTimeoutMs: 10_000,
  /** App: how long a token request waits for the host. */
  tokenRequestTimeoutMs: 10_000,
  /** App: a cached token is refreshed when it expires within this many seconds. */
  tokenRefreshMarginSeconds: 30,
  /** App: how long a v2 request (except `confirm`) waits for `result`. */
  requestTimeoutMs: 10_000,
  /** Host: identical token requests within this window share one issued token. */
  hostTokenCacheMs: 5_000,
});

// ─────────────────────────────────────────────────────────────────────────────
// Message shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Store context of the frame. Informational: identity comes from the verified session token. */
export interface StoreContext {
  storeId: number;
  regionId: number;
  currencyCode: string;
}

export interface EntityRef {
  type: ResourceKey;
  id: string;
}

export interface InitMessage {
  type: typeof MessageType.Init;
  /** Absent on v1 hosts. */
  contractVersion: number;
  pluginKey: string;
  /** v1 field; equals `uiLocale`. */
  locale: string;
  /** Language of the panel chrome. */
  uiLocale: string;
  /** Language of the store content being shown (region language). */
  contentLocale: string;
  surface: SurfaceKey;
  /** Record the surface is about (detail surfaces), else `null`. */
  entity: EntityRef | null;
  storeContext: StoreContext;
  hostOrigin: string;
  hostCapabilities: HostCapabilityKey[];
  /** In-app path to show first (full-page surface), else `null`. */
  path: string | null;
}

export interface TokenMessage {
  type: typeof MessageType.Token;
  requestId: string;
  token: string;
}

export interface TokenErrorMessage {
  type: typeof MessageType.TokenError;
  requestId: string;
  /** Access reason code (see the API's app access gate), or `token_unavailable`. */
  reason: string;
}

export interface ResultMessage {
  type: typeof MessageType.Result;
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: ResultErrorCode;
}

export type HostMessage = InitMessage | TokenMessage | TokenErrorMessage | ResultMessage;

export interface ToastRequest { message: string; tone: ToastTone }
export interface TitleRequest { title: string }
export interface NavigateRequest { path: string }
export interface RedirectRequest { resource: ResourceKey; id: string }
export interface OpenRequest { url: string }
export interface ConfirmRequest { title: string; message: string; confirmLabel: string | null; tone: ConfirmTone }
export interface LoadingRequest { active: boolean }

/** Payload of each host action. */
export interface HostActionPayloads {
  toast: ToastRequest;
  title: TitleRequest;
  navigate: NavigateRequest;
  redirect: RedirectRequest;
  open: OpenRequest;
  confirm: ConfirmRequest;
  loading: LoadingRequest;
}

/** Result data of each host action. */
export interface HostActionResults {
  toast: null;
  title: null;
  navigate: null;
  redirect: null;
  open: null;
  confirm: { confirmed: boolean };
  loading: null;
}

export type AppMessage =
  | { type: typeof MessageType.Ready }
  | { type: typeof MessageType.Resize; height: number }
  | { type: typeof MessageType.TokenRequest; requestId: string }
  | { [K in HostCapabilityKey]: { type: (typeof CAPABILITY_MESSAGE)[K]; capability: K; requestId: string; payload: HostActionPayloads[K] } }[HostCapabilityKey];

// ─────────────────────────────────────────────────────────────────────────────
// Validation (used by both ends; never trust the other side)
// ─────────────────────────────────────────────────────────────────────────────

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) return null;
  if (trimmed.length > max) return null;
  return trimmed;
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= LIMITS.requestId && !CONTROL_CHARS.test(value);
}

/** In-app path: starts with a single `/`, no backslash, no control characters. */
export function isAppPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= LIMITS.path &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !CONTROL_CHARS.test(value)
  );
}

/** Positive integer record id (as string). */
export function isResourceId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value) && value.length <= LIMITS.resourceId;
}

/** External URL the host may open: absolute https only. */
export function isOpenableUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > LIMITS.url || CONTROL_CHARS.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Loopback hosts allowed over plain http (local development only). */
export const LOOPBACK_HOSTNAMES: readonly string[] = Object.freeze(["localhost", "127.0.0.1", "[::1]"]);

/** Origin allowed for a host panel or an app frame: https, or http on loopback. */
export function isSecureOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTNAMES.includes(url.hostname);
}

type ParsedRequest<K extends HostCapabilityKey> = { ok: true; payload: HostActionPayloads[K] } | { ok: false };

function parseRequestPayload<K extends HostCapabilityKey>(capability: K, msg: Record<string, unknown>): ParsedRequest<K> {
  const done = (payload: HostActionPayloads[HostCapabilityKey]) => ({ ok: true as const, payload: payload as HostActionPayloads[K] });
  switch (capability) {
    case "toast": {
      const message = text(msg.message, LIMITS.toastMessage);
      const tone = msg.tone;
      if (message === null || !(TOAST_TONES as readonly unknown[]).includes(tone)) return { ok: false };
      return done({ message, tone: tone as ToastTone });
    }
    case "title": {
      const title = text(msg.title, LIMITS.title, true);
      return title === null ? { ok: false } : done({ title });
    }
    case "navigate":
      return isAppPath(msg.path) ? done({ path: msg.path }) : { ok: false };
    case "redirect": {
      const id = typeof msg.id === "number" && Number.isSafeInteger(msg.id) ? String(msg.id) : msg.id;
      return isResource(msg.resource) && isResourceId(id) ? done({ resource: msg.resource, id }) : { ok: false };
    }
    case "open":
      return isOpenableUrl(msg.url) ? done({ url: msg.url }) : { ok: false };
    case "confirm": {
      const title = text(msg.title, LIMITS.confirmTitle);
      const message = text(msg.message, LIMITS.confirmMessage);
      const confirmLabel = msg.confirmLabel == null ? null : text(msg.confirmLabel, LIMITS.confirmLabel);
      const tone = msg.tone;
      if (title === null || message === null || (msg.confirmLabel != null && confirmLabel === null)) return { ok: false };
      if (!(CONFIRM_TONES as readonly unknown[]).includes(tone)) return { ok: false };
      return done({ title, message, confirmLabel, tone: tone as ConfirmTone });
    }
    case "loading":
      return typeof msg.active === "boolean" ? done({ active: msg.active }) : { ok: false };
    default:
      return { ok: false };
  }
}

const CAPABILITY_BY_MESSAGE: ReadonlyMap<string, HostCapabilityKey> = new Map<string, HostCapabilityKey>(
  HOST_CAPABILITIES.map((cap) => [CAPABILITY_MESSAGE[cap], cap]),
);

/**
 * Parses a message received by the host.
 * - `null`: not a Milofly bridge message (ignore).
 * - `{ ok: false }`: a Milofly message that must be answered with `result` `error` (when it carries a request id).
 */
export type AppMessageParse =
  | { ok: true; message: AppMessage }
  | { ok: false; type: string; requestId: string | null; error: typeof ResultError.Unsupported | typeof ResultError.Invalid };

export function parseAppMessage(data: unknown): AppMessageParse | null {
  const msg = asRecord(data);
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("milofly:")) return null;
  const type = msg.type;
  const requestId = isRequestId(msg.requestId) ? msg.requestId : null;

  if (type === MessageType.Ready) return { ok: true, message: { type } };
  if (type === MessageType.Resize) {
    const h = msg.height;
    return typeof h === "number" && Number.isFinite(h) && h > 0
      ? { ok: true, message: { type, height: h } }
      : { ok: false, type, requestId: null, error: ResultError.Invalid };
  }
  if (type === MessageType.TokenRequest) {
    return requestId ? { ok: true, message: { type, requestId } } : { ok: false, type, requestId: null, error: ResultError.Invalid };
  }

  const capability = CAPABILITY_BY_MESSAGE.get(type);
  if (!capability) return { ok: false, type, requestId, error: ResultError.Unsupported };
  if (!requestId) return { ok: false, type, requestId: null, error: ResultError.Invalid };
  const parsed = parseRequestPayload(capability, msg);
  if (!parsed.ok) return { ok: false, type, requestId, error: ResultError.Invalid };
  return {
    ok: true,
    message: { type: CAPABILITY_MESSAGE[capability], capability, requestId, payload: parsed.payload } as AppMessage,
  };
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Validates an `init` message. Only contract v2+ is accepted: every field is required and nothing is
 * filled in on the app's behalf (a v1 host never sends `contractVersion`; the SDK does not guess one).
 * Returns the reason when the message is rejected so the app can report it.
 */
export function parseInitMessage(data: unknown): { ok: true; message: InitMessage } | { ok: false; reason: string } {
  const msg = asRecord(data);
  if (!msg || msg.type !== MessageType.Init) return { ok: false, reason: "not_init" };
  if (typeof msg.contractVersion !== "number" || msg.contractVersion < 2) return { ok: false, reason: "contract_version_unsupported" };
  const store = asRecord(msg.storeContext);
  const storeId = positiveInt(store?.storeId);
  const regionId = positiveInt(store?.regionId);
  if (!store || storeId === null || regionId === null || typeof store.currencyCode !== "string" || store.currencyCode.length === 0)
    return { ok: false, reason: "store_context_invalid" };
  if (typeof msg.pluginKey !== "string" || msg.pluginKey.length === 0) return { ok: false, reason: "plugin_key_invalid" };
  if (typeof msg.uiLocale !== "string" || msg.uiLocale.length === 0) return { ok: false, reason: "ui_locale_invalid" };
  if (typeof msg.contentLocale !== "string" || msg.contentLocale.length === 0) return { ok: false, reason: "content_locale_invalid" };
  if (!isSurface(msg.surface)) return { ok: false, reason: "surface_invalid" };
  if (typeof msg.hostOrigin !== "string" || !isSecureOrigin(msg.hostOrigin)) return { ok: false, reason: "host_origin_invalid" };
  if (!Array.isArray(msg.hostCapabilities)) return { ok: false, reason: "host_capabilities_invalid" };

  let entity: EntityRef | null = null;
  const expected = SURFACE_RESOURCE[msg.surface];
  if (expected !== null) {
    const rec = asRecord(msg.entity);
    const id = rec ? (typeof rec.id === "number" ? String(rec.id) : rec.id) : null;
    if (!rec || rec.type !== expected || !isResourceId(id)) return { ok: false, reason: "entity_invalid" };
    entity = { type: expected, id };
  } else if (msg.entity != null) {
    return { ok: false, reason: "entity_invalid" };
  }
  if (msg.path != null && !isAppPath(msg.path)) return { ok: false, reason: "path_invalid" };

  return {
    ok: true,
    message: {
      type: MessageType.Init,
      contractVersion: msg.contractVersion,
      pluginKey: msg.pluginKey,
      locale: msg.uiLocale,
      uiLocale: msg.uiLocale,
      contentLocale: msg.contentLocale,
      surface: msg.surface,
      entity,
      storeContext: { storeId, regionId, currencyCode: store.currencyCode },
      hostOrigin: msg.hostOrigin,
      // Unknown capability names from a newer host are dropped: the app cannot call what it does not know.
      hostCapabilities: msg.hostCapabilities.filter((c): c is HostCapabilityKey => (HOST_CAPABILITIES as readonly unknown[]).includes(c)),
      path: typeof msg.path === "string" ? msg.path : null,
    },
  };
}

/** Parses a `token`, `token-error` or `result` message received by the app. `null` = not one of them / invalid. */
export function parseHostReply(data: unknown): TokenMessage | TokenErrorMessage | ResultMessage | null {
  const msg = asRecord(data);
  if (!msg || !isRequestId(msg.requestId)) return null;
  switch (msg.type) {
    case MessageType.Token:
      return typeof msg.token === "string" && msg.token.length > 0
        ? { type: MessageType.Token, requestId: msg.requestId, token: msg.token }
        : null;
    case MessageType.TokenError:
      return typeof msg.reason === "string" && msg.reason.length > 0
        ? { type: MessageType.TokenError, requestId: msg.requestId, reason: msg.reason }
        : null;
    case MessageType.Result: {
      if (typeof msg.ok !== "boolean") return null;
      if (msg.ok) return { type: MessageType.Result, requestId: msg.requestId, ok: true, data: msg.data };
      const error = (Object.values(ResultError) as unknown[]).includes(msg.error) ? (msg.error as ResultErrorCode) : null;
      return error === null ? null : { type: MessageType.Result, requestId: msg.requestId, ok: false, error };
    }
    default:
      return null;
  }
}
