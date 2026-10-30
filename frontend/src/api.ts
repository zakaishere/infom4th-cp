// Bearer-token API client. Access tokens last 15 minutes; refresh tokens rotate on use.
export type Session = { accessToken: string; refreshToken: string; expiresAt: number };
export type Me = { id: string; email: string; handle: string; display_name: string; roles: string[] };

const KEY = "cp.session";
let session: Session | null = load();
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function store(next: Session | null) {
  session = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: session lives in memory only */
  }
  listeners.forEach((listener) => listener());
}

export function onSessionChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasSession() {
  return session !== null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function acceptSession(body: { accessToken: string; refreshToken: string; expiresIn: number }) {
  store({ accessToken: body.accessToken, refreshToken: body.refreshToken, expiresAt: Date.now() + body.expiresIn * 1000 });
}

async function refresh(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= (async () => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: session!.refreshToken }),
      });
      if (!response.ok) {
        store(null);
        return false;
      }
      acceptSession(await response.json());
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

type Options = { body?: unknown; idempotencyKey?: string; anonymous?: boolean };

export async function api<T = any>(method: string, path: string, options: Options = {}): Promise<T> {
  if (!options.anonymous && session && session.expiresAt - Date.now() < 30_000) await refresh();
  const send = () => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (!options.anonymous && session) headers.Authorization = "Bearer " + session.accessToken;
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    return fetch(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  };
  let response = await send();
  if (response.status === 401 && !options.anonymous && session && (await refresh())) response = await send();
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text ? safeJson(text) : undefined;
  if (!response.ok) {
    const message = (data && typeof data === "object" && "error" in data && String(data.error)) || statusText(response.status);
    throw new ApiError(response.status, message);
  }
  return data as T;
}

/** Saves a protected file. A plain link cannot send the sign-in token, so it is fetched first. */
export async function download(path: string, filename: string) {
  if (session && session.expiresAt - Date.now() < 30_000) await refresh();
  const send = () => fetch(path, { headers: session ? { Authorization: "Bearer " + session.accessToken } : {} });
  let response = await send();
  if (response.status === 401 && session && (await refresh())) response = await send();
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
  if (session) {
    try {
      await api("POST", "/api/auth/logout", { body: { refreshToken: session.refreshToken } });
    } catch {
      /* the local session is cleared regardless */
    }
  }
  store(null);
}

// ---------- Server clock ----------
// performance.now() keeps counting steadily even if someone changes the laptop's clock mid-contest.
let clockBase = Date.now() - performance.now();
let zone = "UTC";

/** Current server time in milliseconds. Every contest timer on every screen reads this. */
export function serverNow() {
  return clockBase + performance.now();
}

/** The one time zone contest dates and times are shown in, whatever the laptop is set to. */
export function displayTimeZone() {
  return zone;
}

/** Uses the fastest of a few samples, because a quick response has the smallest network error. */
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
      /* offline: keep the last known offset and try again at the next sync */
    }
  }
}

export const get = <T = any>(path: string) => api<T>("GET", path);
export const post = <T = any>(path: string, body: unknown = {}, idempotencyKey?: string) => api<T>("POST", path, { body, idempotencyKey });
export const put = <T = any>(path: string, body: unknown) => api<T>("PUT", path, { body });
export const patch = <T = any>(path: string, body: unknown) => api<T>("PATCH", path, { body });
export const del = <T = any>(path: string) => api<T>("DELETE", path);
