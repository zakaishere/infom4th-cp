import { navigate, useAuth, useData } from "../../app";
import { AdminIcon, type AdminIconName } from "../../components/AdminIcons";
import { FullscreenAlertBanner, useFullscreenAlerts } from "../../components/FullscreenLog";
import { AdminMissionDetail, AdminMissionList } from "./AdminMissions";
import Analytics from "./Analytics";
import Benchmark from "./Benchmark";
import { ContestDetail, ContestList } from "./Contests";
import ContestWizard from "./ContestWizard";
import Dashboard from "./Dashboard";
import DuelProblems from "./DuelProblems";
import JudgingSettings from "./JudgingSettings";
import { Audit, Languages, UserDetail, Users } from "./Platform";
import PracticeSet from "./PracticeSet";
import ProblemImport from "./ProblemImport";
import { ProblemEditor, ProblemList } from "./Problems";
import ProblemWizard from "./ProblemWizard";
import { TeamDetail, Teams } from "./Teams";

type Item = { key: string; label: string; icon: AdminIconName; count?: number; alert?: boolean };

export default function Admin({ parts }: { parts: string[] }) {
  const { superAdmin, organizer, setter } = useAuth();
  const contests = useData<{ status: string }[]>(organizer ? "/api/manage/competitions" : null, 30000);
  const problems = useData<{ status: string }[]>(setter ? "/api/lab/problems" : null, 30000);
  const live = (contests.data ?? []).filter((c) => c.status === "RUNNING").length;
  const review = (problems.data ?? []).filter((p) => p.status === "READY_FOR_REVIEW").length;
  const alerts = useFullscreenAlerts(organizer);
  const warning = (alerts.data?.count ?? 0) > 0;

  const groups: { title: string; items: (Item | false)[] }[] = [
    {
      title: "Run",
      items: [
        { key: "overview", label: "Overview", icon: "overview" },
        organizer && {
          key: "contests",
          label: "Contests",
          icon: "contests",
          count: warning ? alerts.data?.count : live || undefined,
          alert: warning,
        },
        organizer && { key: "analytics", label: "Analytics", icon: "analytics" },
      ],
    },
    {
      title: "Build",
      items: [
        setter && { key: "problems", label: "Problem Bank", icon: "bank", count: review || undefined },
        organizer && { key: "practice", label: "Practice & TDs", icon: "practice" },
        organizer && { key: "missions", label: "Missions", icon: "missions" },
        organizer && { key: "duel-problems", label: "Duel Pool", icon: "duels" },
      ],
    },
    {
      title: "System",
      items: [
        superAdmin && { key: "judging", label: "Judges & capacity", icon: "judging" },
        superAdmin && { key: "benchmark", label: "Benchmark", icon: "benchmark" },
        superAdmin && { key: "languages", label: "Languages", icon: "languages" },
        superAdmin && { key: "users", label: "Users", icon: "users" },
        superAdmin && { key: "teams", label: "Teams", icon: "teams" },
        superAdmin && { key: "audit", label: "Audit log", icon: "audit" },
      ],
    },
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
  else if (current === "missions" && organizer && parts[1]) page = <AdminMissionDetail key={parts[1]} slug={parts[1]} />;
  else if (current === "missions" && organizer) page = <AdminMissionList />;
  else if (current === "duel-problems" && organizer && parts[1] === "import") page = <ProblemImport duel />;
  else if (current === "duel-problems" && organizer) page = <DuelProblems />;
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
                <a
                  key={s.key}
                  href={"#/admin/" + s.key}
                  className={(current === s.key ? "active " : "") + (s.alert ? "nav-alert" : "")}
                >
                  <span className="ico">
                    <AdminIcon name={s.icon} />
                  </span>
                  <span>{s.label}</span>
                  {s.count ? <span className="count">{s.count}</span> : null}
                </a>
              ))}
            </div>
          );
        })}
        <div className="group">Create</div>
        <div className="quick">
          {organizer && (
            <button className="primary small" onClick={() => navigate("/admin/contests/new")}>
              <AdminIcon name="plus" size={13} /> New contest
            </button>
          )}
          {setter && (
            <button className="small" onClick={() => navigate("/admin/problems/import")}>
              <AdminIcon name="upload" size={13} /> Bulk import
            </button>
          )}
          {setter && (
            <button className="small" onClick={() => navigate("/admin/problems/new")}>
              <AdminIcon name="plus" size={13} /> New problem
            </button>
          )}
          {superAdmin && (
            <button className="small" onClick={() => navigate("/admin/users/import")}>
              <AdminIcon name="users" size={13} /> Import users
            </button>
          )}
        </div>
      </nav>
      <main className="admin-main">
        {alerts.data && warning && <FullscreenAlertBanner alert={alerts.data} onDismiss={alerts.dismiss} />}
        {page}
      </main>
    </div>
  );
}
