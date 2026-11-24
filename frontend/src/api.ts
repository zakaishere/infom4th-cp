// BFF cookie-session API client. No auth tokens are stored in localStorage.
export type Me = { id: string; email: string; handle: string; display_name: string; roles: string[]; is_idp?: boolean };

const listeners = new Set<() => void>();

export function onSessionChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifySessionChange() {
  listeners.forEach((listener) => listener());
}

/** Kept as a no-op helper for callers that previously stored tokens; the HttpOnly cookie is set by the server. */
export function acceptSession(_body?: unknown) {
  notifySessionChange();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function readCookie(name: string): string | null {
  const prefix = name + "=";
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

type Options = { body?: unknown; idempotencyKey?: string; anonymous?: boolean };

export async function api<T = any>(method: string, path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const xsrf = readCookie("XSRF-TOKEN");
    if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
  }
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text ? safeJson(text) : undefined;
  if (!response.ok) {
    const message = (data && typeof data === "object" && "error" in data && String(data.error)) || statusText(response.status);
    throw new ApiError(response.status, message);
  }
  return data as T;
}

/** Opens InfoM4th OIDC sign-in in a popup window, falling back to full-page redirect if blocked. */
export async function loginWithInfoM4th(): Promise<void> {
  const popupUrl = "/oauth2/authorization/infom4th?popup=1";
  const fullUrl = "/oauth2/authorization/infom4th";
  if (window.matchMedia("(max-width: 768px)").matches) {
    // Mobile / narrow screens: full-page redirect avoids tab-switching and in-app browser popup quirks.
    window.location.assign(fullUrl);
    return;
  }
  const w = 500;
  const h = 660;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  const popup = window.open(popupUrl, "infom4th-sso", `width=${w},height=${h},left=${left},top=${top},popup=yes`);

  if (!popup) {
    window.location.assign(fullUrl);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      window.removeEventListener("message", onMessage);
      if (channel) channel.close();
      clearInterval(poll);
    };
    const finish = (payload: { ok?: boolean; error?: string }) => {
      if (settled) return;
      cleanup();
      if (!payload.ok) {
        reject(new Error(payload.error || "InfoM4th sign-in failed."));
        return;
      }
      notifySessionChange();
      resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data && typeof event.data === "object" && "ok" in event.data) {
        finish(event.data as { ok?: boolean; error?: string });
      }
    };
    window.addEventListener("message", onMessage);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("cp-auth");
      channel.onmessage = (event) => {
        if (event.data && typeof event.data === "object" && "ok" in event.data) {
          finish(event.data as { ok?: boolean; error?: string });
        }
      };
    } catch {
      /* BroadcastChannel unavailable */
    }

    const poll = window.setInterval(() => {
      if (popup.closed && !settled) {
        cleanup();
        api<Me>("GET", "/api/me")
          .then(() => {
            notifySessionChange();
            resolve();
          })
          .catch(() => reject(new Error("Sign-in window was closed.")));
      }
    }, 400);
  });
}

/** Saves a protected file using the browser's HttpOnly session cookie. */
export async function download(path: string, filename: string) {
  const response = await fetch(path, { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, statusText(response.status));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function statusText(status: number) {
  if (status === 401) return "Please sign in again";
  if (status === 403) return "You do not have permission for this action";
  if (status === 404) return "Not found";
  if (status === 429) return "Too many requests; try again shortly";
  if (status >= 500) return "The server is unavailable; try again shortly";
  return "Request failed (" + status + ")";
}

export async function logout() {
  let endSessionUrl: string | null = null;
  try {
    const res = await api<{ ok: boolean; endSessionUrl?: string }>("POST", "/api/auth/logout", { body: {} });
    if (res && typeof res.endSessionUrl === "string" && res.endSessionUrl) {
      endSessionUrl = res.endSessionUrl;
    }
  } catch {
    /* local state is cleared regardless */
  }
  notifySessionChange();
  if (endSessionUrl) {
    window.location.assign(endSessionUrl);
  }
}

// ---------- Server clock ----------
let clockBase = Date.now() - performance.now();
let zone = "UTC";

export function serverNow() {
  return clockBase + performance.now();
}

export function displayTimeZone() {
  return zone;
}

export async function syncServerClock() {
  let fastest = Infinity;
  for (let i = 0; i < 3; i++) {
    try {
      const sent = performance.now();
      const response = await fetch("/api/time", { cache: "no-store" });
      if (!response.ok) continue;
      const body = await response.json();
      const received = performance.now();
      if (received - sent < fastest) {
        fastest = received - sent;
        clockBase = body.serverTime - (sent + received) / 2;
        zone = body.timeZone;
      }
    } catch {
      /* offline */
    }
  }
}

export const get = <T = any>(path: string) => api<T>("GET", path);
export const post = <T = any>(path: string, body: unknown = {}, idempotencyKey?: string) => api<T>("POST", path, { body, idempotencyKey });
export const put = <T = any>(path: string, body: unknown) => api<T>("PUT", path, { body });
export const patch = <T = any>(path: string, body: unknown) => api<T>("PATCH", path, { body });
export const del = <T = any>(path: string) => api<T>("DELETE", path);
