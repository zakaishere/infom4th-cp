import { useEffect, useRef, useState } from "react";
import { post } from "../api";
import { navigate, useAction, useAuth, useData, useServerClock } from "../app";
import Standings, { SCORING_INFO } from "../components/Standings";
import { Badge, CONTEST_FORMAT_LABEL, ErrorBox, Field, Loading, Markdown, UserList, clock, formatDuration, when } from "../ui";
import { runPhase } from "./Home";

export type RunDetail = {
  run: { id: string; competition_id: string; kind: string; status: string; starts_at: string; ends_at: string; manual_start?: boolean; submissions_paused: boolean };
  configuration: { title?: string; description_md: string; rules_md: string; mode: string; duration_seconds: number; scoring_system?: string; wrong_attempt_penalty_seconds?: number; freeze_before_end_seconds?: number; max_team_size?: number;
    contest_format?: "STANDARD" | "BASIC" | "WARMUP"; publish_to_practice?: boolean; require_fullscreen?: boolean };
  problems?: { slot: number; label: string; title: string; time_limit_ms: number; memory_limit_mb: number; points?: number | null; release_day?: number; opens_at?: string; released?: boolean }[];
  /** Warmup days still locked: only how many problems each holds, never their titles. */
  upcomingDays?: { day: number; opensAt: string; count: number }[];
};

export default function Lobby({ runId }: { runId: string }) {
  const detail = useData<RunDetail>("/api/runs/" + runId, 5000);
  const mine = useData<{ run_id: string; entry_id: string; entry_name: string; members: string | null }[]>("/api/me/runs", 15000);
  const { organizer } = useAuth();
  const teams = useData<{ id: string; name: string; captain_id: string }[]>("/api/teams");
  const now = useServerClock();
  const [team, setTeam] = useState("");
  const { busy, run } = useAction();
  const wasUpcoming = useRef(false);
  const r = detail.data?.run;
  const cfg = detail.data?.configuration;
  const entry = mine.data?.find((m) => m.run_id === runId);
  const phase = r ? runPhase(now, r.starts_at, r.ends_at) : null;

  useEffect(() => {
    if (!phase) return;
    if (phase.phase === "upcoming") wasUpcoming.current = true;
    else if (phase.phase === "live" && wasUpcoming.current && entry) {
      wasUpcoming.current = false;
      navigate("/arena/" + runId);
    }
  }, [phase, entry, runId]);

  if (detail.loading) return <Loading />;
  if (!detail.data || !r || !cfg || !phase) return <main className="page"><ErrorBox error={detail.error} /></main>;
  const labels = Object.fromEntries((detail.data.problems ?? []).map((p) => [p.slot, p.label]));
  const fullscreenRequired = Boolean(cfg.require_fullscreen ?? (cfg.contest_format !== "WARMUP"));
  const formatName = CONTEST_FORMAT_LABEL[cfg.contest_format ?? "STANDARD"] ?? "Normal";
  const waitingManual = Boolean(r.manual_start && phase.phase === "upcoming");

  const register = () => run(async () => {
    await post("/api/competitions/" + r.competition_id + "/register", cfg.mode === "TEAM" ? { teamId: team } : {});
    await mine.reload();
  }, "You are registered!");

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{r.kind === "REHEARSAL" ? "Rehearsal" : `${formatName} contest`} · {cfg.mode === "TEAM" ? "Team" : "Individual"}</div>
          <h1>{cfg.title ?? "Contest lobby"}</h1>
          {waitingManual
            ? <p>Registration open · Duration: {formatDuration(cfg.duration_seconds)} · Starts when the organizer opens the contest</p>
            : <p>{when(r.starts_at)} → {when(r.ends_at)} · {formatDuration(cfg.duration_seconds)}</p>}
        </div>
        <div className="stack" style={{ alignItems: "flex-end" }}>
          {phase.phase === "upcoming" && (waitingManual ? <Badge tone="info">Registration open · Waiting for start</Badge> : <div className="countdown">{clock(phase.ms)}</div>)}
          {phase.phase === "live" && <Badge tone="ok">LIVE · {clock(phase.ms)} left</Badge>}
          {phase.phase === "ended" && <Badge>Contest ended</Badge>}
          {r.submissions_paused && <Badge tone="warn">Submissions paused by organizers</Badge>}
        </div>
      </div>

      <div className="grid grid-2">
        <section className="card stack">
          <h3>Your entry</h3>
          {entry ? (
            <>
              <div className="notice ok">{cfg.mode === "TEAM" ? <>You are registered as team <strong>{entry.entry_name}</strong> (<UserList handles={entry.members} />). Every member can submit; results are shared.</> : "You are registered."}</div>
              {phase.phase === "live" && <button className="primary" onClick={() => navigate("/arena/" + runId)}>Enter the arena{fullscreenRequired ? " (full screen)" : ""} ▸</button>}
              {phase.phase === "upcoming" && <p className="muted">{waitingManual ? "Keep this page open — the arena opens automatically as soon as the organizer starts the contest." : "The arena opens automatically at the start. Keep this page open; the countdown follows the server clock."}</p>}
              {phase.phase === "upcoming" && <button onClick={() => navigate("/arena/" + runId)}>Wait in the arena</button>}
            </>
          ) : phase.phase !== "ended" && r.kind === "OFFICIAL" && !organizer ? (
            <>
              {cfg.mode === "TEAM" && (
                <Field label="Team" hint="Only the captain can register a team. Membership is locked after registration.">
                  <select value={team} onChange={(e) => setTeam(e.target.value)}>
                    <option value="">Choose a team…</option>
                    {teams.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              )}
              {phase.phase === "live" && <div className="notice small">The contest has started — you can still join. The clock does not restart for late entrants.</div>}
              <button className="primary" disabled={busy || (cfg.mode === "TEAM" && !team)} onClick={register}>{phase.phase === "live" ? "Join now" : "Register"}</button>
            </>
          ) : (
            organizer ? (
              <div className="stack">
                <p className="muted">You are staff, not an entrant.</p>
                <a className="btn primary" href={"#/admin/contests/" + r.competition_id}>Open the contest monitor</a>
                <a className="btn" href={"#/arena/" + runId}>Preview the arena</a>
              </div>
            ) : <p className="muted">{phase.phase === "ended" ? "The contest is over. The final standings are below." : "Registration is closed for this contest."}</p>
          )}
          <hr />
          <h3>Scoring: {SCORING_INFO[(cfg.scoring_system ?? "ICPC") as keyof typeof SCORING_INFO]?.name}</h3>
          <p className="small">{SCORING_INFO[(cfg.scoring_system ?? "ICPC") as keyof typeof SCORING_INFO]?.summary}
            {cfg.scoring_system === "ICPC" && cfg.wrong_attempt_penalty_seconds != null ? ` Penalty: ${Math.round(cfg.wrong_attempt_penalty_seconds / 60)} minutes per rejected attempt.` : ""}
            {cfg.freeze_before_end_seconds ? ` The scoreboard freezes ${Math.round(cfg.freeze_before_end_seconds / 60)} minutes before the end.` : ""}</p>
          <h3>How it works</h3>
          <ul className="small">
            {fullscreenRequired && <li>The arena runs in full screen. Leaving full screen blocks the arena until you return.</li>}
            <li>{waitingManual ? `All problems open together as soon as the organizer starts the contest (duration: ${formatDuration(cfg.duration_seconds)}).` : `All problems open at ${when(r.starts_at)} and close together at ${when(r.ends_at)}.`}</li>
            <li>Submit as often as you need; each submission is judged on all hidden tests.</li>
            <li>A submission may wait in the queue during busy moments — your submission time counts, not the judging time.</li>
            <li>Use clarifications for questions about the statements. Announcements appear automatically.</li>
          </ul>
        </section>
        <section className="card">
          <h3>Description</h3>
          {cfg.description_md ? <Markdown text={cfg.description_md} /> : <p className="muted">No description.</p>}
          <h3>Rules</h3>
          {cfg.rules_md ? <Markdown text={cfg.rules_md} /> : <p className="muted">Standard ICPC rules.</p>}
        </section>
      </div>

      {phase.phase !== "upcoming" && (
        <section className="card" style={{ marginTop: "1.5rem" }}>
          <h2>Standings</h2>
          <Standings runId={runId} labels={labels} me={entry?.entry_id} poll={phase.phase === "live" ? 5000 : 30000} links />
        </section>
      )}
    </main>
  );
}
