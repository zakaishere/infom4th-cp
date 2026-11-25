import { useState } from "react";
import { navigate, useAuth, useData, useServerClock } from "../app";
import { SCORING_INFO } from "../components/Standings";
import { Badge, CONTEST_FORMAT_LABEL, Empty, ErrorBox, LiveDot, Loading, clock, formatDuration, when } from "../ui";

type ContestFormat = "STANDARD" | "BASIC" | "WARMUP";
type Competition = {
  id: string; slug: string; title: string; status: string; run_id: string; starts_at: string; ends_at: string; manual_start?: boolean;
  mode?: string; scoring_system?: keyof typeof SCORING_INFO; max_team_size?: number; problem_count?: number; entrant_count?: number;
  contest_format?: ContestFormat; require_fullscreen?: boolean;
};
type MyRun = { run_id: string; kind: string; status: string; starts_at: string; ends_at: string; manual_start?: boolean; title: string; competition_id: string; submissions_paused: boolean; contest_format?: ContestFormat; entry_name?: string; members?: string | null; team_id?: string | null };

export function runPhase(now: number, start: string, end: string) {
  const s = new Date(start).getTime(), e = new Date(end).getTime();
  if (now < s) return { phase: "upcoming" as const, ms: s - now };
  if (now < e) return { phase: "live" as const, ms: e - now };
  return { phase: "ended" as const, ms: 0 };
}

export function PhaseBadge({ phase, ms, manualStart }: { phase: string; ms: number; manualStart?: boolean }) {
  if (phase === "live") return <Badge tone="ok">LIVE · {clock(ms)} left</Badge>;
  if (phase === "upcoming") return <Badge tone="info">{manualStart ? "Registration open" : `Starts in ${clock(ms)}`}</Badge>;
  return <Badge>Ended</Badge>;
}

const duration = (c: { starts_at: string; ends_at: string }) =>
  formatDuration(Math.max(60, Math.round((new Date(c.ends_at).getTime() - new Date(c.starts_at).getTime()) / 1000)));

const FORMAT_STYLE: Record<ContestFormat, { borderColor?: string; color?: string }> = {
  BASIC: { borderColor: "var(--ok)", color: "var(--ok)" },
  WARMUP: { borderColor: "#35c7e8", color: "#35c7e8" },
  STANDARD: {},
};

function ContestCard({ c, now, registered, organizer }: { c: Competition; now: number; registered: boolean; organizer: boolean }) {
  const p = runPhase(now, c.starts_at, c.ends_at);
  const total = new Date(c.ends_at).getTime() - new Date(c.starts_at).getTime();
  const enter = p.phase === "live" && registered;
  const waitingManual = Boolean(c.manual_start && p.phase === "upcoming");
  const fmt: ContestFormat = c.contest_format ?? "STANDARD";
  return (
    <div className={"card hover contest-card rise " + p.phase}>
      <div className="contest-top">
        <div className="stack" style={{ gap: "0.3rem" }}>
          <h3>{c.title}</h3>
          <div className="row" style={{ gap: "0.3rem" }}>
            <span className="tag" style={FORMAT_STYLE[fmt]}>{CONTEST_FORMAT_LABEL[fmt] ?? "Normal"}</span>
            {c.scoring_system && <span className="tag scoring">{SCORING_INFO[c.scoring_system]?.name}</span>}
            {c.mode && <span className="tag">{c.mode === "TEAM" ? `Teams of ≤${c.max_team_size}` : "Individual"}</span>}
            {registered && <span className="tag" style={{ color: "var(--ok)", borderColor: "var(--ok)" }}>Registered</span>}
          </div>
        </div>
        {p.phase === "live" ? <span className="tag live">● Live</span> : waitingManual ? <span className="tag" style={{ borderColor: "#35c7e8", color: "#35c7e8" }}>Registration open</span> : p.phase === "upcoming" ? <span className="tag">Upcoming</span> : <span className="tag">Finished</span>}
      </div>
      {p.phase === "ended" ? (
        <div className="small muted">Ended {when(c.ends_at)}</div>
      ) : waitingManual ? (
        <div>
          <div className="small muted">Start time</div>
          <div style={{ fontWeight: 700, fontSize: "1.05rem", color: "#35c7e8", marginTop: "0.15rem" }}>Waiting for organizer to start</div>
        </div>
      ) : (
        <div>
          <div className="small muted">{p.phase === "live" ? "Time left" : "Starts in"}</div>
          <div className="big-clock">{clock(p.ms)}</div>
          {p.phase === "live" && <div className="bar" style={{ marginTop: 6 }}><div style={{ width: (100 * (total - p.ms)) / total + "%" }} /></div>}
        </div>
      )}
      <div className="meta-row">
        <span>{waitingManual ? "📢 Starts when organizer opens" : `🗓 ${when(c.starts_at)}`}</span><span>⏱ {duration(c)}</span>
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
  const [kindFilter, setKindFilter] = useState<"ALL" | ContestFormat>("ALL");
  const myRuns = new Set((mine.data ?? []).map((r) => r.run_id));
  const all = competitions.data ?? [];
  const byKind = kindFilter === "ALL" ? all : all.filter((c) => (c.contest_format ?? "STANDARD") === kindFilter);
  const phaseOf = (c: Competition) => runPhase(now, c.starts_at, c.ends_at).phase;
  const live = byKind.filter((c) => phaseOf(c) === "live");
  const upcoming = byKind.filter((c) => phaseOf(c) === "upcoming").sort((a, b) => (a.manual_start ? 0 : 1) - (b.manual_start ? 0 : 1) || a.starts_at.localeCompare(b.starts_at));
  const ended = byKind.filter((c) => phaseOf(c) === "ended");
  const shown = filter === "live" ? live : filter === "upcoming" ? upcoming : filter === "ended" ? ended : [...live, ...upcoming, ...ended];
  const allLive = all.filter((c) => phaseOf(c) === "live");
  const allUpcoming = all.filter((c) => phaseOf(c) === "upcoming").sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const scheduledUpcoming = allUpcoming.filter((c) => !c.manual_start);
  // Rehearsals and private contests the user entered are not in the public list.
  const privateActive = (mine.data ?? []).filter((r) => !all.some((c) => c.run_id === r.run_id) && runPhase(now, r.starts_at, r.ends_at).phase !== "ended" && r.status !== "FINISHED");
  const next = scheduledUpcoming.find((c) => myRuns.has(c.run_id)) ?? scheduledUpcoming[0];
  const countOfKind = (k: ContestFormat) => all.filter((c) => (c.contest_format ?? "STANDARD") === k).length;

  return (
    <main className="page">
      <section className="hero">
        <div className="eyebrow" style={{ color: "#35c7e8" }}>Welcome back, {me?.display_name}</div>
        <div className="row-between" style={{ alignItems: "flex-start", gap: "1rem" }}>
          <div>
            <h1>Ready to compete?</h1>
            <p>Pick a contest — Basic events, long Warmups, or Normal rounds — register, and enter the arena when the clock hits zero.</p>
          </div>
          {organizer && <button className="primary" onClick={() => navigate("/admin/contests/new")}>+ New contest</button>}
        </div>
        <div className="hero-stats">
          <div><strong>{allLive.length}</strong><span>Live now</span></div>
          <div><strong>{allUpcoming.length}</strong><span>Upcoming</span></div>
          <div><strong>{(mine.data ?? []).length}</strong><span>Contests you entered</span></div>
          {next && <div><strong className="mono">{clock(new Date(next.starts_at).getTime() - now)}</strong><span>Until {next.title}</span></div>}
        </div>
        <img src="/logo.png" alt="" />
      </section>

      {allLive.filter((c) => myRuns.has(c.run_id)).map((c) => (
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
                  <PhaseBadge {...p} manualStart={r.manual_start} />
                  <a className={"btn" + (p.phase === "live" ? " primary" : "")} href={(p.phase === "live" ? "#/arena/" : "#/run/") + r.run_id}>{p.phase === "live" ? "Enter arena ▸" : "Open lobby"}</a>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="row-between" style={{ marginBottom: "0.75rem", gap: "0.75rem" }}>
          <div className="section-title" style={{ margin: 0 }}><h2>Contests</h2><span className="count">{byKind.length}</span></div>
          <div className="row" style={{ gap: "0.75rem" }}>
            <div className="filters" role="group" aria-label="Contest category">
              {([
                ["ALL", `All types (${all.length})`],
                ["BASIC", `Basic (${countOfKind("BASIC")})`],
                ["WARMUP", `Warmup (${countOfKind("WARMUP")})`],
                ["STANDARD", `Normal (${countOfKind("STANDARD")})`],
              ] as const).map(([k, label]) => (
                <button key={k} className={kindFilter === k ? "active" : ""} onClick={() => setKindFilter(k)}>{label}</button>
              ))}
            </div>
            <div className="filters" role="group" aria-label="Contest status">
              {([["all", "All"], ["live", `Live (${live.length})`], ["upcoming", `Upcoming (${upcoming.length})`], ["ended", "Finished"]] as const).map(([k, label]) => (
                <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <ErrorBox error={competitions.error} />
        {competitions.loading ? <Loading /> : shown.length === 0 ? <Empty>{all.length === 0 ? "No public contests yet. Check back soon!" : "No contest matches these filters."}</Empty> : (
          <div className="contest-grid">
            {shown.map((c) => <ContestCard key={c.id} c={c} now={now} registered={myRuns.has(c.run_id)} organizer={organizer} />)}
          </div>
        )}
        <p className="small muted" style={{ marginTop: "1rem" }}>Times are shown in your local time zone and follow the server clock.</p>
      </section>
    </main>
  );
}
