import { useEffect, useState } from "react";
import { acceptSession, api } from "../api";
import { useAuth, useToast } from "../app";
import { Field } from "../ui";

type Mode = "login" | "register" | "forgot" | "reset";

export default function AuthPage() {
  const resetToken = new URLSearchParams(window.location.search).get("token");
  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "login");
  const [form, setForm] = useState({ email: "", password: "", handle: "", displayName: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [delegatedAuth, setDelegatedAuth] = useState(false);
  // The switch always starts on InfoM4th. Flip it only for an old CP account or
  // a non InfoM4th account created by an admin. There is no public signup then.
  const [nonInfoM4th, setNonInfoM4th] = useState(false);
  const { reload } = useAuth();
  const toast = useToast();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const useDelegated = delegatedAuth && mode === "login" && !nonInfoM4th;

  useEffect(() => {
    api<{ delegatedAuth: boolean }>("GET", "/api/auth/config", { anonymous: true })
      .then((cfg) => setDelegatedAuth(Boolean(cfg.delegatedAuth)))
      .catch(() => { /* older backend: keep local login */ });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login" || mode === "register") {
        const body = mode === "login" ? { email: form.email, password: form.password } : form;
        // When InfoM4th is the identity provider, credentials are verified there by
        // the backend; the browser never talks to InfoM4th or sees its secret.
        // Non InfoM4th accounts use the normal /login path in both configurations.
        const path = useDelegated ? "/api/auth/infom4th" : "/api/auth/" + mode;
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

  const go = (next: Mode) => { setError(""); setNonInfoM4th(false); setMode(next); };
  const pickAccountType = (value: boolean) => {
    setNonInfoM4th(value);
    setError("");
    setForm({ ...form, email: "", password: "" });
  };
  const titles: Record<Mode, string> = {
    login: useDelegated ? "Sign in with InfoM4th" : nonInfoM4th ? "Sign in with a non InfoM4th account" : "Sign in",
    register: "Create account", forgot: "Reset password", reset: "Choose a new password",
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
          {delegatedAuth && mode === "login" && (
            <div className="auth-switch" role="group" aria-label="Account type">
              <button type="button" aria-pressed={!nonInfoM4th} onClick={() => pickAccountType(false)}>InfoM4th account</button>
              <button type="button" aria-pressed={nonInfoM4th} onClick={() => pickAccountType(true)}>non InfoM4th account</button>
            </div>
          )}
          {mode !== "reset" && (
            <Field label={useDelegated ? "InfoM4th email" : "Email"}>
              <input type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
            </Field>
          )}
          {mode === "register" && (
            <>
              <Field label="Handle" hint="Shown on standings. Letters, digits, underscore."><input required value={form.handle} onChange={set("handle")} maxLength={32} /></Field>
              <Field label="Display name"><input required value={form.displayName} onChange={set("displayName")} maxLength={100} /></Field>
            </>
          )}
          {mode !== "forgot" && (
            <Field label="Password" hint={mode === "login" ? undefined : "8–72 characters with an uppercase letter, a number and a symbol."}>
              <input type="password" required autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={set("password")} />
            </Field>
          )}
          <button className="primary" disabled={busy}>{busy ? "Please wait…" : titles[mode]}</button>
          <div className="row-between small">
            {delegatedAuth && mode === "login" ? (
              <>
                {useDelegated && <span>Use your InfoM4th email and password. Accounts and password resets are managed in InfoM4th.</span>}
                {nonInfoM4th && <span>Existing non InfoM4th accounts are created by an admin, not through public signup.</span>}
                {nonInfoM4th && <a href="#" onClick={(e) => { e.preventDefault(); go("forgot"); }}>Forgot password?</a>}
              </>
            ) : mode === "login" ? (
              <>
                <a href="#" onClick={(e) => { e.preventDefault(); go("register"); }}>Create an account</a>
                <a href="#" onClick={(e) => { e.preventDefault(); go("forgot"); }}>Forgot password?</a>
              </>
            ) : (
              <a href="#" onClick={(e) => { e.preventDefault(); go("login"); }}>Back to sign in</a>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
