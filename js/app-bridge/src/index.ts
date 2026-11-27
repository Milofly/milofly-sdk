/**
 * Milofly App Bridge — client for apps embedded in the Milofly store panel.
 *
 * ```ts
 * import { createApp } from "@milofly/app-bridge";
 *
 * const app = await createApp();
 * const token = await app.getSessionToken();   // send to YOUR server, verify it there
 * await app.toast("Saved");
 * ```
 *
 * The context in `app` (store, locale, surface) is informational. Identity is what your server reads
 * from the verified session token (`@milofly/app-server` → `verifySessionToken`).
 */
import {
  CAPABILITY_MESSAGE,
  MessageType,
  TIMING,
  UrlParam,
  isSecureOrigin,
  parseHostReply,
  parseInitMessage,
  type ConfirmTone,
  type EntityRef,
  type HostActionPayloads,
  type HostActionResults,
  type HostCapabilityKey,
  type InitMessage,
  type ResourceKey,
  type StoreContext,
  type SurfaceKey,
  type ToastTone,
} from "@milofly/app-bridge/contract";

export * from "@milofly/app-bridge/contract";

/** Error raised by the bridge. `code` is stable and safe to branch on. */
export class MiloflyBridgeError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "MiloflyBridgeError";
    this.code = code;
  }
}

export interface CreateAppOptions {
  /**
   * Host origins this app accepts (e.g. `["https://app.milofly.com"]`). Recommended in production.
   * When omitted, the origin given by the host in `mf_host` is used as long as it is https (or http
   * on loopback). Your server must still verify the session token's `HostOrigin` claim.
   */
  allowedHostOrigins?: readonly string[];
  /** Report content height to the host (detail widgets grow with their content). Default `true`. */
  autoResize?: boolean;
}

export interface MiloflyApp {
  readonly contractVersion: number;
  readonly pluginKey: string;
  readonly surface: SurfaceKey;
  readonly entity: EntityRef | null;
  readonly uiLocale: string;
  readonly contentLocale: string;
  readonly storeContext: StoreContext;
  readonly hostOrigin: string;
  /** In-app path the merchant asked for (reload/deep link of a full-page app), else `null`. */
  readonly initialPath: string | null;
  readonly hostCapabilities: readonly HostCapabilityKey[];
  supports(capability: HostCapabilityKey): boolean;
  /** A session token valid for at least the refresh margin; fetched from the host when needed. */
  getSessionToken(): Promise<string>;
  toast(message: string, options?: { tone?: ToastTone }): Promise<void>;
  setTitle(title: string): Promise<void>;
  /** Tell the host the app is now at `path` (in-app, starts with `/`). The panel URL follows it. */
  navigate(path: string): Promise<void>;
  /** Open an order/product/customer in the panel. */
  redirect(resource: ResourceKey, id: string | number): Promise<void>;
  /** Open an https URL in a new tab (call from a user gesture). */
  open(url: string): Promise<void>;
  confirm(options: { title: string; message: string; confirmLabel?: string; tone?: ConfirmTone }): Promise<boolean>;
  setLoading(active: boolean): Promise<void>;
  destroy(): void;
}

interface TokenState {
  token: string;
  exp: number;
}

function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new MiloflyBridgeError("crypto_unavailable", "Web Crypto is required to create request ids.");
}

/**
 * Reads `Exp` from a session token WITHOUT verifying it — only to decide when to refresh.
 * Never use these claims for authorization; verify the token on your server.
 */
export function readSessionTokenExpiry(token: string): number | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  try {
    const b64 = token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="))) as { Exp?: unknown };
    return typeof json.Exp === "number" ? json.Exp : null;
  } catch {
    return null;
  }
}

function tokenState(token: string): TokenState {
  const exp = readSessionTokenExpiry(token);
  if (exp === null) throw new MiloflyBridgeError("token_malformed", "The host returned a session token without an expiry.");
  return { token, exp };
}

/**
 * Connects to the host panel: reads `mf_host`, sends `ready`, waits for `init`.
 * Rejects with {@link MiloflyBridgeError} (`not_embedded`, `host_origin_missing`, `host_origin_not_allowed`,
 * `handshake_timeout`, `init_invalid:<reason>`).
 */
export function createApp(options: CreateAppOptions = {}): Promise<MiloflyApp> {
  if (typeof window === "undefined") return Promise.reject(new MiloflyBridgeError("no_window"));
  if (window.parent === window) return Promise.reject(new MiloflyBridgeError("not_embedded", "The app is not inside the Milofly panel."));

  const location = new URL(window.location.href);
  const hostOriginParam = location.searchParams.get(UrlParam.HostOrigin);
  if (!hostOriginParam) return Promise.reject(new MiloflyBridgeError("host_origin_missing", `The frame URL has no '${UrlParam.HostOrigin}' parameter.`));
  const hostOrigin: string = hostOriginParam;
  if (!isSecureOrigin(hostOrigin)) return Promise.reject(new MiloflyBridgeError("host_origin_invalid"));
  if (options.allowedHostOrigins && !options.allowedHostOrigins.includes(hostOrigin))
    return Promise.reject(new MiloflyBridgeError("host_origin_not_allowed", `Host origin ${hostOrigin} is not in allowedHostOrigins.`));

  // The URL token is a secret: take it and remove it from the address bar and history.
  const urlToken = location.searchParams.get(UrlParam.EmbedToken);
  if (urlToken !== null) {
    location.searchParams.delete(UrlParam.EmbedToken);
    window.history.replaceState(window.history.state, "", location.toString());
  }

  const parent = window.parent;
  const post = (message: unknown) => parent.postMessage(message, hostOrigin);
  type Reply = NonNullable<ReturnType<typeof parseHostReply>>;
  const pending = new Map<string, { resolve: (msg: Reply) => void; reject: (err: MiloflyBridgeError) => void; timer: ReturnType<typeof setTimeout> | null }>();
  let init: InitMessage | null = null;
  let onInit: ((msg: InitMessage) => void) | null = null;
  let onInitError: ((err: MiloflyBridgeError) => void) | null = null;
  let destroyed = false;

  const onMessage = (event: MessageEvent) => {
    if (destroyed || event.origin !== hostOrigin || event.source !== parent) return;
    const data = event.data as { type?: unknown } | null;
    if (data && data.type === MessageType.Init) {
      const parsed = parseInitMessage(data);
      if (!parsed.ok) {
        onInitError?.(new MiloflyBridgeError(`init_invalid:${parsed.reason}`));
        return;
      }
      if (parsed.message.hostOrigin !== hostOrigin) {
        onInitError?.(new MiloflyBridgeError("init_invalid:host_origin_mismatch"));
        return;
      }
      init = parsed.message;
      onInit?.(parsed.message);
      return;
    }
    const reply = parseHostReply(data);
    if (!reply) return;
    const waiter = pending.get(reply.requestId);
    if (!waiter) return;
    pending.delete(reply.requestId);
    if (waiter.timer !== null) clearTimeout(waiter.timer);
    waiter.resolve(reply);
  };
  window.addEventListener("message", onMessage);

  const awaitReply = (requestId: string, timeoutMs: number | null) =>
    new Promise<Reply>((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              pending.delete(requestId);
              reject(new MiloflyBridgeError("host_timeout", "The host did not answer in time."));
            }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
    });

  return new Promise<MiloflyApp>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new MiloflyBridgeError("handshake_timeout", "The Milofly panel did not answer 'ready'."));
    }, TIMING.handshakeTimeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      onInit = null;
      onInitError = null;
    };
    onInitError = (err) => {
      cleanup();
      destroyed = true;
      window.removeEventListener("message", onMessage);
      reject(err);
    };
    onInit = (first) => {
      cleanup();
      try {
        resolve(buildApp(first));
      } catch (err) {
        destroyed = true;
        window.removeEventListener("message", onMessage);
        reject(err instanceof MiloflyBridgeError ? err : new MiloflyBridgeError("init_failed", String(err)));
      }
    };
    post({ type: MessageType.Ready });
  });

  function buildApp(first: InitMessage): MiloflyApp {
    let token: TokenState | null = urlToken ? tokenState(urlToken) : null;
    let tokenFlight: Promise<string> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const current = () => init ?? first;

    const requestToken = async (): Promise<string> => {
      const requestId = newRequestId();
      const wait = awaitReply(requestId, TIMING.tokenRequestTimeoutMs);
      post({ type: MessageType.TokenRequest, requestId });
      const reply = await wait;
      if (reply.type === MessageType.Token) {
        token = tokenState(reply.token);
        return reply.token;
      }
      if (reply.type === MessageType.TokenError) throw new MiloflyBridgeError(reply.reason, `The host could not issue a session token (${reply.reason}).`);
      throw new MiloflyBridgeError("host_reply_invalid");
    };

    const call = async <K extends HostCapabilityKey>(capability: K, payload: HostActionPayloads[K], timeoutMs: number | null): Promise<HostActionResults[K]> => {
      if (destroyed) throw new MiloflyBridgeError("destroyed");
      if (!current().hostCapabilities.includes(capability)) throw new MiloflyBridgeError("unsupported", `The host does not support '${capability}'.`);
      const requestId = newRequestId();
      const wait = awaitReply(requestId, timeoutMs);
      post({ type: CAPABILITY_MESSAGE[capability], requestId, ...payload });
      const reply = await wait;
      if (reply.type !== MessageType.Result) throw new MiloflyBridgeError("host_reply_invalid");
      if (!reply.ok) throw new MiloflyBridgeError(reply.error ?? "failed");
      return (reply.data ?? null) as HostActionResults[K];
    };

    if (options.autoResize !== false && typeof ResizeObserver !== "undefined") {
      let frame = 0;
      let last = 0;
      resizeObserver = new ResizeObserver(() => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const h = Math.ceil(document.documentElement.scrollHeight);
          if (h > 0 && h !== last) {
            last = h;
            post({ type: MessageType.Resize, height: h });
          }
        });
      });
      resizeObserver.observe(document.documentElement);
    }

    return {
      get contractVersion() { return current().contractVersion; },
      get pluginKey() { return current().pluginKey; },
      get surface() { return current().surface; },
      get entity() { return current().entity; },
      get uiLocale() { return current().uiLocale; },
      get contentLocale() { return current().contentLocale; },
      get storeContext() { return current().storeContext; },
      get hostOrigin() { return hostOrigin; },
      get initialPath() { return first.path; },
      get hostCapabilities() { return current().hostCapabilities; },
      supports: (capability) => current().hostCapabilities.includes(capability),
      getSessionToken() {
        if (destroyed) return Promise.reject(new MiloflyBridgeError("destroyed"));
        const now = Math.floor(Date.now() / 1000);
        if (token && token.exp - now > TIMING.tokenRefreshMarginSeconds) return Promise.resolve(token.token);
        if (!tokenFlight) tokenFlight = requestToken().finally(() => (tokenFlight = null));
        return tokenFlight;
      },
      toast: (message, opts) => call("toast", { message, tone: opts?.tone ?? "info" }, TIMING.requestTimeoutMs).then(() => undefined),
      setTitle: (title) => call("title", { title }, TIMING.requestTimeoutMs).then(() => undefined),
      navigate: (path) => call("navigate", { path }, TIMING.requestTimeoutMs).then(() => undefined),
      redirect: (resource, id) => call("redirect", { resource, id: String(id) }, TIMING.requestTimeoutMs).then(() => undefined),
      open: (url) => call("open", { url }, TIMING.requestTimeoutMs).then(() => undefined),
      // The merchant decides at their own pace: no timeout.
      confirm: (o) =>
        call("confirm", { title: o.title, message: o.message, confirmLabel: o.confirmLabel ?? null, tone: o.tone ?? "default" }, null).then(
          (r) => r.confirmed,
        ),
      setLoading: (active) => call("loading", { active }, TIMING.requestTimeoutMs).then(() => undefined),
      destroy() {
        destroyed = true;
        window.removeEventListener("message", onMessage);
        resizeObserver?.disconnect();
        for (const [id, w] of pending) {
          if (w.timer !== null) clearTimeout(w.timer);
          pending.delete(id);
          w.reject(new MiloflyBridgeError("destroyed"));
        }
      },
    };
  }
}
