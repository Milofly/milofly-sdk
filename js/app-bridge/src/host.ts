/**
 * Milofly App Bridge — host engine.
 *
 * Used by the Milofly store panel to run one embedded app frame. Framework-free: the panel's React
 * component owns rendering (overlay, toasts, dialogs) and hands the engine plain callbacks.
 *
 * Security rules (unchanged from v1, now in one place):
 * - Messages are accepted only from the app origin AND from this frame's window. Another frame of
 *   the same origin on the same page (detail widgets) cannot answer or trigger this frame's turn.
 * - Messages are posted only to the app origin, never to `"*"`.
 * - The app key used for token requests is the host's own value, never read from a message.
 */
import {
  CONTRACT_VERSION,
  HOST_CAPABILITIES,
  MessageType,
  ResultError,
  TIMING,
  UrlParam,
  isSecureOrigin,
  parseAppMessage,
  type EntityRef,
  type HostActionPayloads,
  type HostActionResults,
  type HostCapabilityKey,
  type InitMessage,
  type ResultErrorCode,
  type StoreContext,
  type SurfaceKey,
} from "@milofly/app-bridge/contract";

export * from "@milofly/app-bridge/contract";

/** Why an app URL cannot be framed. */
export type AppUrlRejection = "invalid" | "opaque" | "same_origin" | "insecure";

export type AppUrlCheck = { ok: true; url: URL; origin: string } | { ok: false; reason: AppUrlRejection };

/**
 * Decides whether `appUrl` may be framed by a host at `hostOrigin`.
 * - The app must have its own origin: a same-origin frame with `allow-same-origin` escapes the sandbox.
 * - https only; plain http only on loopback (local development).
 * - Opaque origins (`data:`, `blob:`, `javascript:`) are refused: origin checks cannot hold for them.
 */
export function checkAppUrl(appUrl: string, hostOrigin: string): AppUrlCheck {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.origin === "null") return { ok: false, reason: "opaque" };
  if (url.origin === hostOrigin) return { ok: false, reason: "same_origin" };
  if (!isSecureOrigin(url.origin)) return { ok: false, reason: "insecure" };
  return { ok: true, url, origin: url.origin };
}

/**
 * Adds the bridge parameters to the frame URL. The session token is optional: detail widgets fetch
 * it over the bridge instead (their URL stays token-free).
 */
export function buildFrameUrl(
  baseUrl: string,
  params: { hostOrigin: string; embedToken?: string | null; path?: string | null },
): string {
  const url = new URL(baseUrl);
  url.searchParams.set(UrlParam.HostOrigin, params.hostOrigin);
  if (params.path) url.searchParams.set(UrlParam.Path, params.path);
  if (params.embedToken) url.searchParams.set(UrlParam.EmbedToken, params.embedToken);
  return url.toString();
}

/** Outcome of the host's token provider. `reason` is the access gate's reason code. */
export type TokenResult = { ok: true; token: string } | { ok: false; reason: string };

/** Host action handlers. A missing handler means the host does not offer that capability. */
export type HostHandlers = {
  [K in HostCapabilityKey]?: (payload: HostActionPayloads[K]) => Promise<HostActionResults[K]> | HostActionResults[K];
};

export interface ResizePolicy {
  min: number;
  max: number;
  /** Changes smaller than this are ignored: breaks the "frame resizes → content reflows → new height" loop. */
  epsilon: number;
}

export interface HostOptions {
  iframe: HTMLIFrameElement;
  /** Origin returned by {@link checkAppUrl}. */
  appOrigin: string;
  pluginKey: string;
  surface: SurfaceKey;
  uiLocale: string;
  contentLocale: string;
  entity: EntityRef | null;
  storeContext: StoreContext;
  /** In-app path opened first (full-page surface), else `null`. */
  path: string | null;
  /** Issues a fresh session token for this app on this surface. */
  getSessionToken: () => Promise<TokenResult>;
  handlers: HostHandlers;
  /** Starting height of the frame; `resize` messages are compared with it. */
  initialHeight: number;
  /** `null`: the frame fills its container and `resize` is ignored (full-page apps). */
  resizePolicy: ResizePolicy | null;
  onHeight?: (height: number) => void;
  /** First `ready` from the app, or the load fallback fired. */
  onReady?: () => void;
  /** Invalid or unsupported messages from the app (for the host's own diagnostics). */
  onProtocolError?: (detail: { type: string; error: ResultErrorCode }) => void;
}

export interface HostHandle {
  /** Call from the iframe's `load` event: starts the `init` fallback for apps that never send `ready`. */
  frameLoaded(): void;
  /** Capabilities announced in `init`. */
  readonly capabilities: readonly HostCapabilityKey[];
  destroy(): void;
}

/** Starts the bridge for one frame. Call {@link HostHandle.destroy} when the frame is removed. */
export function createHost(options: HostOptions): HostHandle {
  const { iframe, appOrigin } = options;
  const hostOrigin = window.location.origin;
  const capabilities = HOST_CAPABILITIES.filter((cap) => typeof options.handlers[cap] === "function");

  let destroyed = false;
  let initSent = false;
  let readySignalled = false;
  let height = options.initialHeight;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let tokenCache: { token: string; at: number } | null = null;
  let tokenInFlight: Promise<TokenResult> | null = null;

  const post = (message: unknown) => {
    if (destroyed) return;
    iframe.contentWindow?.postMessage(message, appOrigin);
  };

  const signalReady = () => {
    if (readySignalled) return;
    readySignalled = true;
    options.onReady?.();
  };

  const initMessage = (): InitMessage => ({
    type: MessageType.Init,
    contractVersion: CONTRACT_VERSION,
    pluginKey: options.pluginKey,
    locale: options.uiLocale,
    uiLocale: options.uiLocale,
    contentLocale: options.contentLocale,
    surface: options.surface,
    entity: options.entity,
    storeContext: options.storeContext,
    hostOrigin,
    hostCapabilities: [...capabilities],
    path: options.path,
  });

  // `init` is answered to EVERY `ready`: an app whose script started after the load fallback fired
  // would otherwise wait forever (v1 sent `init` once).
  const sendInit = () => {
    initSent = true;
    post(initMessage());
  };

  const freshToken = (): Promise<TokenResult> => {
    if (tokenCache && Date.now() - tokenCache.at < TIMING.hostTokenCacheMs) return Promise.resolve({ ok: true, token: tokenCache.token });
    if (tokenInFlight) return tokenInFlight;
    const flight = options
      .getSessionToken()
      .then((result) => {
        if (result.ok) tokenCache = { token: result.token, at: Date.now() };
        return result;
      })
      .finally(() => {
        if (tokenInFlight === flight) tokenInFlight = null;
      });
    tokenInFlight = flight;
    return flight;
  };

  const reply = (requestId: string, ok: boolean, data?: unknown, error?: ResultErrorCode) =>
    post(ok ? { type: MessageType.Result, requestId, ok: true, data } : { type: MessageType.Result, requestId, ok: false, error });

  const runAction = <K extends HostCapabilityKey>(capability: K, requestId: string, payload: HostActionPayloads[K]) => {
    const handler = options.handlers[capability] as ((p: HostActionPayloads[K]) => Promise<HostActionResults[K]> | HostActionResults[K]) | undefined;
    if (!handler) {
      reply(requestId, false, undefined, ResultError.Unsupported);
      return;
    }
    Promise.resolve()
      .then(() => handler(payload))
      .then(
        (data) => reply(requestId, true, data ?? null),
        (err: unknown) => {
          const code = err instanceof HostActionDenied ? ResultError.Denied : ResultError.Failed;
          if (code === ResultError.Failed) console.error(`[milofly-app-bridge] ${options.pluginKey}: '${capability}' failed`, err);
          reply(requestId, false, undefined, code);
        },
      );
  };

  const onMessage = (event: MessageEvent) => {
    if (destroyed || event.origin !== appOrigin || event.source !== iframe.contentWindow) return;
    const parsed = parseAppMessage(event.data);
    if (!parsed) return;
    if (!parsed.ok) {
      options.onProtocolError?.({ type: parsed.type, error: parsed.error });
      if (parsed.requestId) reply(parsed.requestId, false, undefined, parsed.error);
      return;
    }
    const msg = parsed.message;
    switch (msg.type) {
      case MessageType.Ready:
        sendInit();
        signalReady();
        return;
      case MessageType.Resize: {
        const policy = options.resizePolicy;
        if (!policy) return;
        const next = Math.min(policy.max, Math.max(policy.min, Math.round(msg.height)));
        if (Math.abs(next - height) < policy.epsilon) return;
        height = next;
        options.onHeight?.(next);
        return;
      }
      case MessageType.TokenRequest: {
        const { requestId } = msg;
        void freshToken().then(
          (result) =>
            post(
              result.ok
                ? { type: MessageType.Token, requestId, token: result.token }
                : { type: MessageType.TokenError, requestId, reason: result.reason },
            ),
          (err: unknown) => {
            console.error(`[milofly-app-bridge] ${options.pluginKey}: token provider failed`, err);
            post({ type: MessageType.TokenError, requestId, reason: "token_unavailable" });
          },
        );
        return;
      }
      default:
        runAction(msg.capability, msg.requestId, msg.payload as never);
    }
  };

  window.addEventListener("message", onMessage);

  return {
    capabilities,
    frameLoaded() {
      if (destroyed) return;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (!initSent) sendInit();
        signalReady();
      }, TIMING.initFallbackMs);
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("message", onMessage);
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = null;
    },
  };
}

/** Throw from a handler when the host refuses the action (answered as `denied`, not `failed`). */
export class HostActionDenied extends Error {
  constructor(message = "denied") {
    super(message);
    this.name = "HostActionDenied";
  }
}
