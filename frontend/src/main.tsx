import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./refresh.css";
import "./practice.css";
import "./profile.css";
import "./duel.css";
import "./admin.css";
import { AuthProvider, ToastProvider, keepServerClockSynced, navigate, useAuth, useRoute, useTheme } from "./app";
import { logout, syncServerClock } from "./api";
import { Loading } from "./ui";
import AuthPage from "./pages/Auth";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Arena from "./pages/Arena";
import { PracticeList, PracticeProblem } from "./pages/Practice";
import TdList from "./pages/Td";
import { MissionList, MissionPage, MissionCard } from "./pages/Missions";
import { DuelHub, DuelRoom } from "./pages/Duels";
import Teams from "./pages/Teams";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import HeadToHead from "./pages/HeadToHead";
import TeamProfile from "./pages/TeamProfile";
import Admin from "./pages/admin/Admin";
import { Avatar } from "./components/Avatar";

function Shell() {
  const { me, loading, organizer, setter } = useAuth();
  const staff = organizer || setter;
  const { path, parts } = useRoute();
  const { theme, toggle } = useTheme();
  if (loading) return <Loading label="Connecting…" />;
  // Password reset links arrive as /reset-password?token=... from the backend email.
  if (!me || new URLSearchParams(window.location.search).has("token")) return <AuthPage />;
  // The arena owns the whole screen: no navigation chrome while competing.
  if (parts[0] === "arena" && parts[1]) return <Arena runId={parts[1]} />;
  const isProblemSet = parts.length === 0 || parts[0] === "practice" || parts[0] === "problems";
  const isContests = parts[0] === "contests" || parts[0] === "run";
  const link = (to: string, label: string, active?: boolean) => (
    <a href={"#" + to} className={(active ?? (path === to || (to !== "/" && path.startsWith(to)))) ? "active" : ""}>{label}</a>
  );
  let page;
  if (parts[0] === "run" && parts[1]) page = <Lobby runId={parts[1]} />;
  else if ((parts[0] === "practice" || parts[0] === "problems") && parts[1]) page = <PracticeProblem versionId={parts[1]} />;
  else if (parts[0] === "practice" || parts[0] === "problems") page = <PracticeList />;
  else if (parts[0] === "td" && parts[1]) page = <PracticeProblem key={parts[1]} versionId={parts[1]} section="td" />;
  else if (parts[0] === "td") page = <TdList />;
  else if (parts[0] === "missions" && parts[1] && parts[2] === "card" && parts[3]) page = <MissionCard key={parts[1] + parts[3]} slug={parts[1]} handle={parts[3]} />;
  else if (parts[0] === "missions" && parts[1] && parts[2]) page = <PracticeProblem key={parts[2]} versionId={parts[2]} section="mission" mission={parts[1]} />;
  else if (parts[0] === "missions" && parts[1]) page = <MissionPage key={parts[1]} slug={parts[1]} />;
  else if (parts[0] === "missions") page = <MissionList />;
  else if (parts[0] === "duel" && parts[1]) page = <DuelRoom key={parts[1]} id={parts[1]} />;
  else if (parts[0] === "duels") page = <DuelHub />;
  else if (parts[0] === "teams") page = <Teams />;
  else if (parts[0] === "leaderboard") page = <Leaderboard />;
  else if (parts[0] === "u" && parts[1] && parts[2] === "vs" && parts[3]) page = <HeadToHead first={parts[1]} second={parts[3]} />;
  else if (parts[0] === "u" && parts[1]) page = <Profile key={parts[1]} handle={parts[1]} />;
  else if (parts[0] === "team" && parts[1]) page = <TeamProfile id={parts[1]} />;
  else if (parts[0] === "contests") page = <Home />;
  else if (parts[0] === "admin" && (organizer || setter)) page = <Admin parts={parts.slice(1)} />;
  else page = <PracticeList />;
  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand">
          <img src="/logo.png" alt="" />
          <span>INFO<b>M4TH</b></span>
          <small>Arena</small>
        </a>
        <nav className="nav">
          {link("/", "Problem Set", isProblemSet)}
          {link("/contests", "Contests", isContests)}
          {link("/td", "TD")}
          {link("/missions", "Missions")}
          {link("/duels", "Duels")}
          {link("/leaderboard", "Leaderboard")}
          {!staff && link("/teams", "Teams")}
          {staff && link("/admin", "Control room")}
        </nav>
        <div className="topbar-right">
          <button className="ghost small" onClick={toggle} title="Toggle theme">{theme === "dark" ? "☀" : "☾"}</button>
          <a className="btn ghost small row" style={{ gap: "0.5rem", padding: "0.15rem 0.4rem" }} title={`Your profile (@${me.handle})`} href={"#/u/" + me.handle}>
            <Avatar handle={me.handle} src={me.avatar_url} size={28} />
            <span className="small">{me.display_name || me.handle}</span>
          </a>
          <button className="small" onClick={async () => { await logout(); navigate("/"); }}>Sign out</button>
        </div>
      </header>
      {page}
    </>
  );
}

// Timers must not flash a wrong state from the laptop's clock, but a slow network must not block the page.
Promise.race([syncServerClock(), new Promise((done) => setTimeout(done, 2000))]).finally(() => {
  keepServerClockSynced();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ToastProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ToastProvider>
    </StrictMode>,
  );
});
