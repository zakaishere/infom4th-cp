import { useState } from "react";
import { useAuth, useData, useServerClock } from "../app";
import { SCORING_INFO } from "../components/Standings";
import { Badge, Empty, ErrorBox, LiveDot, Loading, clock, when } from "../ui";

type Competition = {
  id: string; slug: string; title: string; status: string; run_id: string; starts_at: string; ends_at: string;
  mode?: string; scoring_system?: keyof typeof SCORING_INFO; max_team_size?: number; problem_count?: number; entrant_count?: number;
};
type MyRun = { run_id: string; kind: string; status: string; starts_at: string; ends_at: string; title: string; competition_id: string; submissions_paused: boolean; entry_name?: string; members?: string | null; team_id?: string | null };

export function runPhase(now: number, start: string, end: string) {
  const s = new Date(start).getTime(), e = new Date(end).getTime();
  if (now < s) return { phase: "upcoming" as const, ms: s - now };
  if (now < e) return { phase: "live" as const, ms: e - now };
  return { phase: "ended" as const, ms: 0 };
}

export function PhaseBadge({ phase, ms }: { phase: string; ms: number }) {
  if (phase === "live") return <Badge tone="ok">LIVE · {clock(ms)} left</Badge>;
  if (phase === "upcoming") return <Badge tone="info">Starts in {clock(ms)}</Badge>;
  return <Badge>Ended</Badge>;
}

const duration = (c: { starts_at: string; ends_at: string }) => {
  const m = Math.round((new Date(c.ends_at).getTime() - new Date(c.starts_at).getTime()) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : m + " min";
};

function ContestCard({ c, now, registered, organizer }: { c: Competition; now: number; registered: boolean; organizer: boolean }) {
  const p = runPhase(now, c.starts_at, c.ends_at);
  const total = new Date(c.ends_at).getTime() - new Date(c.starts_at).getTime();
  const enter = p.phase === "live" && registered;
  return (
    <div className={"card hover contest-card rise " + p.phase}>
      <div className="contest-top">
        <div className="stack" style={{ gap: "0.3rem" }}>
          <h3>{c.title}</h3>
          <div className="row" style={{ gap: "0.3rem" }}>
            {c.scoring_system && <span className="tag scoring">{SCORING_INFO[c.scoring_system]?.name}</span>}
            {c.mode && <span className="tag">{c.mode === "TEAM" ? `Teams of ≤${c.max_team_size}` : "Individual"}</span>}
            {registered && <span className="tag" style={{ color: "var(--ok)", borderColor: "var(--ok)" }}>Registered</span>}
          </div>
        </div>
        {p.phase === "live" ? <span className="tag live">● Live</span> : p.phase === "upcoming" ? <span className="tag">Upcoming</span> : <span className="tag">Finished</span>}
      </div>
      {p.phase !== "ended" ? (
        <div>
          <div className="small muted">{p.phase === "live" ? "Time left" : "Starts in"}</div>
          <div className="big-clock">{clock(p.ms)}</div>
          {p.phase === "live" && <div className="bar" style={{ marginTop: 6 }}><div style={{ width: (100 * (total - p.ms)) / total + "%" }} /></div>}
        </div>
      ) : <div className="small muted">Ended {when(c.ends_at)}</div>}
      <div className="meta-row">
        <span>🗓 {when(c.starts_at)}</span><span>⏱ {duration(c)}</span>
        {c.problem_count != null && <span>▤ {c.problem_count} problems</span>}
        {c.entrant_count != null && <span>👥 {c.entrant_count} {c.mode === "TEAM" ? "teams" : "entrants"}</span>}
      </div>
      <div className="row" style={{ marginTop: "auto" }}>
        <a className={"btn" + (enter || (p.phase === "upcoming" && !registered) ? " primary" : "")} href={(enter ? "#/arena/" : "#/run/") + c.run_id}>
          {enter ? "Enter arena ▸" : p.phase === "ended" ? "Results & scoreboard" : registered ? "Open lobby" : p.phase === "live" ? "Join now" : "Register"}
        </a>
        {organizer && <a className="btn small" href={"#/admin/contests/" + c.id}>Manage</a>}
      </div>
    </div>
  );
}

export default function Home() {
  const { me, organizer } = useAuth();
  const competitions = useData<Competition[]>("/api/competitions", 30000);
  const mine = useData<MyRun[]>("/api/me/runs", 30000);
  const now = useServerClock();
  const [filter, setFilter] = useState<"all" | "live" | "upcoming" | "ended">("all");
  const myRuns = new Set((mine.data ?? []).map((r) => r.run_id));
  const all = competitions.data ?? [];
  const phaseOf = (c: Competition) => runPhase(now, c.starts_at, c.ends_at).phase;
  const live = all.filter((c) => phaseOf(c) === "live");
  const upcoming = all.filter((c) => phaseOf(c) === "upcoming").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const ended = all.filter((c) => phaseOf(c) === "ended");
  const shown = filter === "live" ? live : filter === "upcoming" ? upcoming : filter === "ended" ? ended : [...live, ...upcoming, ...ended];
  // Rehearsals and private contests the user entered are not in the public list.
  const privateActive = (mine.data ?? []).filter((r) => !all.some((c) => c.run_id === r.run_id) && runPhase(now, r.starts_at, r.ends_at).phase !== "ended" && r.status !== "FINISHED");
  const next = upcoming.find((c) => myRuns.has(c.run_id)) ?? upcoming[0];

  return (
    <main className="page">
      <section className="hero">
        <div className="eyebrow" style={{ color: "#35c7e8" }}>Welcome back, {me?.display_name}</div>
        <h1>Ready to compete?</h1>
        <p>Pick a contest, register, and the arena opens by itself when the clock hits zero. Solve fast, avoid wrong answers, and climb the live scoreboard.</p>
        <div className="hero-stats">
          <div><strong>{live.length}</strong><span>Live now</span></div>
          <div><strong>{upcoming.length}</strong><span>Upcoming</span></div>
          <div><strong>{(mine.data ?? []).length}</strong><span>Contests you entered</span></div>
          {next && <div><strong className="mono">{clock(new Date(next.starts_at).getTime() - now)}</strong><span>Until {next.title}</span></div>}
        </div>
        <img src="/logo.png" alt="" />
      </section>

      {live.filter((c) => myRuns.has(c.run_id)).map((c) => (
        <a key={c.id} href={"#/arena/" + c.run_id} className="notice ok row-between rise" style={{ marginBottom: "1.25rem", color: "inherit", textDecoration: "none" }}>
          <span className="row"><LiveDot /><strong>{c.title} is live</strong><span className="muted">{clock(new Date(c.ends_at).getTime() - now)} left</span></span>
          <span className="btn primary small">Enter arena ▸</span>
        </a>
      ))}

      {privateActive.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <div className="section-title"><h2>Your private sessions</h2><span className="count">{privateActive.length}</span></div>
          <div className="contest-grid">
            {privateActive.map((r) => {
              const p = runPhase(now, r.starts_at, r.ends_at);
              return (
                <div key={r.run_id} className="card hover contest-card">
                  <div className="contest-top"><h3>{r.title}</h3>{r.kind === "REHEARSAL" && <span className="tag">Rehearsal</span>}</div>
                  <PhaseBadge {...p} />
                  <a className={"btn" + (p.phase === "live" ? " primary" : "")} href={(p.phase === "live" ? "#/arena/" : "#/run/") + r.run_id}>{p.phase === "live" ? "Enter arena ▸" : "Open lobby"}</a>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="row-between" style={{ marginBottom: "1rem" }}>
          <div className="section-title" style={{ margin: 0 }}><h2>Contests</h2><span className="count">{all.length}</span></div>
          <div className="filters">
            {([["all", "All"], ["live", `Live (${live.length})`], ["upcoming", `Upcoming (${upcoming.length})`], ["ended", "Finished"]] as const).map(([k, label]) => (
              <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
        </div>
        <ErrorBox error={competitions.error} />
        {competitions.loading ? <Loading /> : shown.length === 0 ? <Empty>{filter === "all" ? "No public contests yet. Check back soon!" : "Nothing here right now."}</Empty> : (
          <div className="contest-grid">
            {shown.map((c) => <ContestCard key={c.id} c={c} now={now} registered={myRuns.has(c.run_id)} organizer={organizer} />)}
          </div>
        )}
        <p className="small muted" style={{ marginTop: "1rem" }}>Times are shown in your local time zone and follow the server clock.</p>
      </section>
    </main>
  );
}
