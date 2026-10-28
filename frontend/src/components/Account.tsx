import { useState } from "react";
import { acceptSession, post } from "../api";
import { useToast } from "../app";
import { Field, Modal } from "../ui";

/** Signed-in password change. Other sessions end; this browser stays signed in. */
export function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const strong = next.length >= 8 && /[A-Z]/.test(next) && /[0-9]/.test(next) && /[^A-Za-z0-9]/.test(next);
  return (
    <Modal title="Change password" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null);
        try {
          acceptSession(await post("/api/me/password", { currentPassword: current, newPassword: next }));
          toast("success", "Password changed. Other devices were signed out.");
          onClose();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not change the password");
        } finally { setBusy(false); }
      }}>
        <Field label="Current password"><input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="New password" hint="At least 8 characters with an uppercase letter, a number and a symbol.">
          <input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Repeat the new password"><input type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} /></Field>
        {repeat && repeat !== next && <div className="notice warn small">The two new passwords differ.</div>}
        {error && <div className="notice bad small">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !strong || next !== repeat || !current}>Change password</button>
        </div>
      </form>
    </Modal>
  );
}
