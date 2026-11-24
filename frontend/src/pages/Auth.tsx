import { useEffect, useState } from "react";
import { acceptSession, api, loginWithInfoM4th } from "../api";
import { useAuth, useToast } from "../app";
import { Field } from "../ui";

// Accounts and password resets for InfoM4th users live on the main website.
const INFO_M4TH_SIGNUP_URL = "https://www.infom4th.com/login?mode=register";
const INFO_M4TH_FORGOT_URL = "https://www.infom4th.com/login?reset=1";

type Mode = "login" | "register" | "forgot" | "reset";

function EyeIcon({ off }: { off?: boolean }) {
  return off ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="m1 1 22 22" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PasswordInput({
  label,
  hint,
  id,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  hint?: string;
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          id={id}
          name="password"
          type={show ? "text" : "password"}
          required
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={onChange}
        />
        <button
          type="button"
          className="toggle"
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          onClick={() => setShow((v) => !v)}
        >
          <EyeIcon off={show} />
        </button>
      </div>
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}

export default function AuthPage() {
  const resetToken = new URLSearchParams(window.location.search).get("token");
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [form, setForm] = useState({ email: "", password: "", handle: "", displayName: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delegatedAuth, setDelegatedAuth] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  // Clean default: show only "Sign in with InfoM4th". Reveal local email/password form only when clicked.
  const [showLocalForm, setShowLocalForm] = useState(false);
  const { reload } = useAuth();
  const toast = useToast();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const useSsoView = delegatedAuth && oidcEnabled && mode === "login" && !showLocalForm;

  useEffect(() => {
    api<{ delegatedAuth: boolean; oidc?: boolean }>("GET", "/api/auth/config", { anonymous: true })
      .then((cfg) => {
        setDelegatedAuth(Boolean(cfg.delegatedAuth));
        setOidcEnabled(Boolean(cfg.oidc));
      })
      .catch(() => { /* keep local login */ });
  }, []);

  async function handleOidcPopup() {
    setBusy(true);
    setError("");
    try {
      const signedIn = await loginWithInfoM4th();
      if (signedIn) await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login" || mode === "register") {
        const body = mode === "login" ? { email: form.email, password: form.password } : form;
        const path = delegatedAuth && !oidcEnabled && mode === "login" && !showLocalForm
          ? "/api/auth/infom4th"
          : "/api/auth/" + mode;
        acceptSession(await api("POST", path, { body, anonymous: true }));
        await reload();
      } else if (mode === "forgot") {
        const result = await api("POST", "/api/auth/forgot-password", { body: { email: form.email }, anonymous: true });
        toast("info", result.message);
        setMode("login");
      } else {
        await api("POST", "/api/auth/reset-password", { body: { token: resetToken, password: form.password }, anonymous: true });
        toast("success", "Password changed. Sign in with your new password.");
        window.history.replaceState(null, "", window.location.pathname);
        setMode("login");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const go = (next: Mode) => { setError(""); setMode(next); };
  const toggleLocal = (open: boolean) => {
    setShowLocalForm(open);
    setError("");
    setForm({ ...form, email: "", password: "" });
  };
  const titles: Record<Mode, string> = {
    login: useSsoView ? "Welcome back" : showLocalForm ? "Non InfoM4th account" : "Sign in",
    register: "Create account",
    forgot: "Reset password",
    reset: "Choose a new password",
  };
  const quietLinkStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    color: "#9fc6d1",
    textDecoration: "underline",
    textUnderlineOffset: "4px",
    cursor: "pointer",
    fontSize: "0.9rem",
  };
  return (
    <div className="auth">
      <section className="auth-art">
        <img src="/logo.png" alt="InfoM4th" />
        <div>
          <div className="eyebrow" style={{ color: "#35c7e8" }}>InfoM4th competitive programming</div>
          <h1>Think fast.<br />Code clean.<br />Get accepted.</h1>
          <p style={{ maxWidth: 460, color: "#cfeaf1" }}>
            Official contests with ICPC scoring, sandboxed judging, live standings and clarifications —
            plus practice problems to sharpen your skills between rounds.
          </p>
        </div>
        <small style={{ color: "#9fc6d1" }}>Contest time always follows the server clock.</small>
      </section>
      <section className="auth-form">
        <form className="card stack" onSubmit={submit}>
          <div className="brand"><img src="/logo.png" alt="" /> <span>INFO<b>M4TH</b></span> <small>Arena</small></div>
          <h2>{titles[mode]}</h2>
          {error && <div className="notice bad">{error}</div>}

          {useSsoView ? (
            <>
              <button type="button" className="btn primary" disabled={busy} onClick={handleOidcPopup}>
                {busy ? "Signing in…" : "Sign in with InfoM4th"}
              </button>
              <small className="hint" style={{ textAlign: "center" }}>
                Already signed in on InfoM4th? You will be signed in automatically.
              </small>
              <div style={{ borderTop: "1px solid rgba(53,199,232,0.16)", paddingTop: 12, textAlign: "center" }}>
                <button type="button" style={quietLinkStyle} onClick={() => toggleLocal(true)}>
                  Sign in with a non InfoM4th account
                </button>
              </div>
            </>
          ) : (
            <>
              {mode !== "reset" && (
                <Field label="Email">
                  <input id="email" name="email" type="email" required autoComplete="email" autoCapitalize="none" spellCheck={false} value={form.email} onChange={set("email")} />
                </Field>
              )}
              {mode === "register" && (
                <>
                  <Field label="Handle" hint="Shown on standings. Letters, digits, underscore."><input name="handle" required value={form.handle} onChange={set("handle")} maxLength={32} /></Field>
                  <Field label="Display name"><input name="name" required value={form.displayName} onChange={set("displayName")} maxLength={100} /></Field>
                </>
              )}
              {mode !== "forgot" && (
                <PasswordInput
                  id="password"
                  label={mode === "reset" ? "New password" : "Password"}
                  hint={mode === "register" || mode === "reset" ? "At least 8 characters with uppercase, digit and symbol." : undefined}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={form.password}
                  onChange={set("password")}
                />
              )}
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? "Working…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Set new password"}
              </button>
              {delegatedAuth && oidcEnabled && mode === "login" && (
                <div style={{ paddingTop: 6, textAlign: "center" }}>
                  <button type="button" style={quietLinkStyle} onClick={() => toggleLocal(false)}>
                    ← Back to Sign in with InfoM4th
                  </button>
                </div>
              )}
            </>
          )}

          {mode === "login" ? (
            delegatedAuth ? (
              useSsoView ? (
                <div className="auth-links">
                  <div>
                    <a href={INFO_M4TH_SIGNUP_URL} target="_blank" rel="noopener noreferrer">Sign up on InfoM4th</a>
                    {" · "}
                    <a href={INFO_M4TH_FORGOT_URL} target="_blank" rel="noopener noreferrer">Forgot password?</a>
                  </div>
                </div>
              ) : (
                <div className="auth-links">
                  <small>Local accounts are for legacy or admin-created users.</small>
                  <div>
                    <button type="button" className="link" onClick={() => go("forgot")}>Forgot local password?</button>
                  </div>
                </div>
              )
            ) : (
              <div className="auth-links">
                <button type="button" className="link" onClick={() => go("register")}>Create account</button>
                {" · "}
                <button type="button" className="link" onClick={() => go("forgot")}>Forgot password?</button>
              </div>
            )
          ) : (
            <div className="auth-links">
              <button type="button" className="link" onClick={() => go("login")}>Back to sign in</button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
