import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./refresh.css";
import "./practice.css";
import { AuthProvider, ToastProvider, navigate, useAuth, useRoute, useTheme } from "./app";
import { logout } from "./api";
import { Loading } from "./ui";
import AuthPage from "./pages/Auth";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Arena from "./pages/Arena";
import { PracticeList, PracticeProblem } from "./pages/Practice";
import Teams from "./pages/Teams";
import Admin from "./pages/admin/Admin";
import { ChangePassword } from "./components/Account";

function Shell() {
  const { me, loading, organizer, setter } = useAuth();
  const staff = organizer || setter;
  const { path, parts } = useRoute();
  const { theme, toggle } = useTheme();
  const [account, setAccount] = useState(false);
  if (loading) return <Loading label="Connecting…" />;
  // Password reset links arrive as /reset-password?token=... from the backend email.
  if (!me || new URLSearchParams(window.location.search).has("token")) return <AuthPage />;
  // The arena owns the whole screen: no navigation chrome while competing.
  if (parts[0] === "arena" && parts[1]) return <Arena runId={parts[1]} />;
  const link = (to: string, label: string) => (
    <a href={"#" + to} className={path === to || (to !== "/" && path.startsWith(to)) ? "active" : ""}>{label}</a>
  );
  let page;
  if (parts[0] === "run" && parts[1]) page = <Lobby runId={parts[1]} />;
  else if (parts[0] === "practice" && parts[1]) page = <PracticeProblem versionId={parts[1]} />;
  else if (parts[0] === "practice") page = <PracticeList />;
  else if (parts[0] === "teams") page = <Teams />;
  else if (parts[0] === "contests") page = <Home />;
  else if (staff && parts.length === 0) page = <Admin parts={[]} />;
  else if (parts[0] === "admin" && (organizer || setter)) page = <Admin parts={parts.slice(1)} />;
  else page = <Home />;
  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand">
          <img src="/logo.png" alt="" />
          <span>INFO<b>M4TH</b></span>
          <small>Arena</small>
        </a>
        <nav className="nav">
          {staff ? (
            <>
              {link("/admin", "Control room")}
              {link("/contests", "Contests")}
              {link("/practice", "Practice")}
            </>
          ) : (
            <>
              {link("/", "Contests")}
              {link("/practice", "Practice")}
              {link("/teams", "Teams")}
            </>
          )}
        </nav>
        <div className="topbar-right">
          <button className="ghost small" onClick={toggle} title="Toggle theme">{theme === "dark" ? "☀" : "☾"}</button>
          <button className="ghost small row" style={{ gap: "0.5rem", padding: "0.15rem 0.4rem" }} title="Account: change password" onClick={() => setAccount(true)}>
            <span className="avatar">{(me.display_name || me.handle).slice(0, 1).toUpperCase()}</span>
            <span className="small muted">@{me.handle}</span>
          </button>
          <button className="small" onClick={async () => { await logout(); navigate("/"); }}>Sign out</button>
        </div>
      </header>
      {page}
      {account && <ChangePassword onClose={() => setAccount(false)} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
