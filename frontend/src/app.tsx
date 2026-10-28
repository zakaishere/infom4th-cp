import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, get, hasSession, onSessionChange, type Me } from "./api";

// ---------- Routing (hash based, no server rewrites needed) ----------
export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const update = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const [path, query = ""] = hash.split("?");
  return { path, parts: path.split("/").filter(Boolean), query: new URLSearchParams(query) };
}
export const navigate = (to: string) => {
  window.location.hash = to;
};

// ---------- Authentication ----------
type Auth = {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
  is: (role: string) => boolean;
  superAdmin: boolean;
  organizer: boolean;
  setter: boolean;
};
const AuthContext = createContext<Auth>(null as unknown as Auth);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(hasSession());
  const reload = useCallback(async () => {
    if (!hasSession()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await get<Me>("/api/me"));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
    return onSessionChange(() => {
      if (!hasSession()) setMe(null);
    });
  }, [reload]);
  const value = useMemo<Auth>(() => {
    const roles = new Set(me?.roles ?? []);
    const superAdmin = roles.has("SUPER_ADMIN");
    const organizer = superAdmin || roles.has("ADMIN");
    return { me, loading, reload, is: (r) => roles.has(r), superAdmin, organizer, setter: organizer || roles.has("MODERATOR") };
  }, [me, loading, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------- Toasts ----------
type Toast = { id: number; kind: "info" | "error" | "success"; text: string };
const ToastContext = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++counter.current;
    setToasts((all) => [...all.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + t.kind}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- Data loading ----------
export function useData<T>(path: string | null, intervalMs = 0) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await get<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "Network error; retrying"));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(path !== null);
    setData(undefined);
    reload();
    if (!intervalMs || !path) return;
    // Pause polling while the tab is hidden to spare the API during large contests.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [path, intervalMs, reload]);
  return { data, error, loading, reload, setData };
}

/** Runs an action, reports failures as toasts, and exposes a busy flag. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await action();
        if (success) toast("success", success);
        return result;
      } catch (e) {
        toast("error", e instanceof Error ? e.message : "Action failed");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

// ---------- Server clock ----------
/** Offset between the server clock and this browser; contest timing always follows the server. */
export function useServerClock(serverTime?: string) {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (serverTime) setOffset(new Date(serverTime).getTime() - Date.now());
  }, [serverTime]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  return now + offset;
}

// ---------- Theme ----------
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("cp.theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      /* ignore */
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("cp.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
