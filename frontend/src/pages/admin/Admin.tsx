import { navigate, useAuth, useData } from "../../app";
import JudgingSettings from "./JudgingSettings";
import Dashboard from "./Dashboard";
import ProblemWizard from "./ProblemWizard";
import ProblemImport from "./ProblemImport";
import ContestWizard from "./ContestWizard";
import { ContestDetail, ContestList } from "./Contests";
import { ProblemEditor, ProblemList } from "./Problems";
import { Audit, Languages, UserDetail, Users } from "./Platform";
import { TeamDetail, Teams } from "./Teams";
import PracticeSet from "./PracticeSet";
import Analytics from "./Analytics";
import Benchmark from "./Benchmark";
import { FullscreenAlertBanner, useFullscreenAlerts } from "../../components/FullscreenLog";

type Item = { key: string; label: string; icon: string; count?: number; alert?: boolean };

export default function Admin({ parts }: { parts: string[] }) {
  const { superAdmin, organizer, setter } = useAuth();
  const contests = useData<{ status: string }[]>(organizer ? "/api/manage/competitions" : null, 30000);
  const problems = useData<{ status: string }[]>(setter ? "/api/lab/problems" : null, 30000);
  const live = (contests.data ?? []).filter((c) => c.status === "RUNNING").length;
  const review = (problems.data ?? []).filter((p) => p.status === "READY_FOR_REVIEW").length;
  const alerts = useFullscreenAlerts(organizer);
  const warning = (alerts.data?.count ?? 0) > 0;
  const groups: { title: string; items: (Item | false)[] }[] = [
    { title: "Run", items: [
      { key: "overview", label: "Overview", icon: "◉" },
      organizer && { key: "contests", label: "Contests", icon: "⚑", count: warning ? alerts.data?.count : live || undefined, alert: warning },
      organizer && { key: "analytics", label: "Analytics", icon: "▤" },
    ] },
    { title: "Build", items: [
      setter && { key: "problems", label: "Problem lab", icon: "✎", count: review || undefined },
      organizer && { key: "practice", label: "Practice set", icon: "★" },
    ] },
    { title: "System", items: [
      superAdmin && { key: "judging", label: "Judges & capacity", icon: "⚙" },
      superAdmin && { key: "benchmark", label: "Benchmark", icon: "⏱" },
      superAdmin && { key: "languages", label: "Languages", icon: "{}" },
      superAdmin && { key: "users", label: "Users", icon: "☺" },
      superAdmin && { key: "teams", label: "Teams", icon: "⚐" },
      superAdmin && { key: "audit", label: "Audit log", icon: "≡" },
    ] },
  ];
  const current = parts[0] ?? "overview";
  let page;
  if (current === "overview") page = <Dashboard />;
  else if (current === "contests" && parts[1] === "new") page = <ContestWizard />;
  else if (current === "contests" && parts[1]) page = <ContestDetail id={parts[1]} />;
  else if (current === "contests") page = <ContestList />;
  else if (current === "problems" && parts[1] === "new") page = <ProblemWizard />;
  else if (current === "problems" && parts[1] === "import") page = <ProblemImport />;
  else if (current === "problems" && parts[1]) page = <ProblemEditor versionId={parts[1]} />;
  else if (current === "problems") page = <ProblemList />;
  else if (current === "analytics" && organizer) page = <Analytics />;
  else if (current === "practice" && organizer) page = <PracticeSet />;
  else if (current === "judging" && superAdmin) page = <JudgingSettings />;
  else if (current === "benchmark" && superAdmin) page = <Benchmark />;
  else if (current === "languages" && superAdmin) page = <Languages />;
  else if (current === "users" && superAdmin && parts[1] && parts[1] !== "import") page = <UserDetail key={parts[1]} id={parts[1]} />;
  else if (current === "users" && superAdmin) page = <Users key={parts[1] ?? ""} importOpen={parts[1] === "import"} />;
  else if (current === "teams" && superAdmin && parts[1]) page = <TeamDetail key={parts[1]} id={parts[1]} />;
  else if (current === "teams" && superAdmin) page = <Teams />;
  else if (current === "audit" && superAdmin) page = <Audit />;
  else page = <div className="empty">Choose a section.</div>;
  return (
    <div className="admin-shell">
      <nav className="admin-nav" aria-label="Control room">
        {groups.map((g) => {
          const items = g.items.filter(Boolean) as Item[];
          if (!items.length) return null;
          return (
            <div key={g.title} style={{ display: "contents" }}>
              <div className="group">{g.title}</div>
              {items.map((s) => (
                <a key={s.key} href={"#/admin/" + s.key} className={(current === s.key ? "active " : "") + (s.alert ? "nav-alert" : "")}>
                  <span className="ico">{s.icon}</span>{s.label}{s.count ? <span className="count">{s.count}</span> : null}
                </a>
              ))}
            </div>
          );
        })}
        <div className="group">Create</div>
        <div className="quick">
          {organizer && <button className="primary small" onClick={() => navigate("/admin/contests/new")}>+ New contest</button>}
          {setter && <button className="small" onClick={() => navigate("/admin/problems/new")}>+ New problem</button>}
          {superAdmin && <button className="small" onClick={() => navigate("/admin/users/import")}>+ Import users</button>}
        </div>
      </nav>
      <main className="admin-main">
        {alerts.data && warning && <FullscreenAlertBanner alert={alerts.data} onDismiss={alerts.dismiss} />}
        {page}
      </main>
    </div>
  );
}
