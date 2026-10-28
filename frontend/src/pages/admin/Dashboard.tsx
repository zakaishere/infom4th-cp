import { useEffect, useState } from "react";
import { get, post } from "../../api";
import { useAction, useAuth, useData, useServerClock } from "../../app";
import { Badge, Empty, LiveDot, Loading, Meter, ReasonDialog, Stat, clock } from "../../ui";
import { runPhase } from "../Home";

type Competition = { id: string; title: string; status: string };
type Run = { id: string; kind: string; status: string; starts_at: string; ends_at: string; submissions_paused: boolean };
type LiveRun = Run & { competition: Competition; submissions: number; waiting: number; openQuestions: number };

/** Gathers the contests that matter now: running, scheduled, or in rehearsal. */
function useLiveRuns(competitions?: Competition[]) {
  const [runs, setRuns] = useState<LiveRun[] | null>(null);
  useEffect(() => {
    if (!competitions) return;
    let cancelled = false;
    const load = async () => {
      const active = competitions.filter((c) => ["SCHEDULED", "RUNNING", "INTERNAL_TESTING", "READY"].includes(c.status)).slice(0, 8);
      const result: LiveRun[] = [];
      for (const c of active) {
        try {
          const detail = await get<{ runs: Run[] }>("/api/manage/competitions/" + c.id);
          for (const r of detail.runs.filter((r) => r.status !== "FINISHED" && r.status !== "ARCHIVED")) {
            const [subs, questions] = await Promise.all([
              get<{ status: string }[]>("/api/manage/runs/" + r.id + "/submissions"),
              get<{ answer: string | null }[]>("/api/runs/" + r.id + "/clarifications"),
            ]);
            result.push({ ...r, competition: c, submissions: subs.length, waiting: subs.filter((s) => s.status === "QUEUED" || s.status === "RUNNING" || s.status === "RETRY").length, openQuestions: questions.filter((q) => !q.answer).length });
          }
        } catch { /* a contest the user cannot manage is skipped */ }
      }
      if (!cancelled) setRuns(result.sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(); }, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [competitions]);
  return runs;
}

export default function Dashboard() {
  const { superAdmin, organizer, setter } = useAuth();
  const competitions = useData<Competition[]>(organizer ? "/api/manage/competitions" : null, 30000);
  const problems = useData<{ version_id: string; title: string; status: string }[]>(setter ? "/api/lab/problems" : null, 30000);
  const judging = useData<any>(superAdmin ? "/api/admin/judging/settings" : null, 5000);
  const runs = useLiveRuns(competitions.data);
  const now = useServerClock();
  const [pause, setPause] = useState<LiveRun | null>(null);
  const [startNow, setStartNow] = useState<LiveRun | null>(null);
  const { run } = useAction();
  const review = (problems.data ?? []).filter((p) => p.status === "READY_FOR_REVIEW");
  const drafts = (problems.data ?? []).filter((p) => p.status === "DRAFT" || p.status === "IN_TESTING");
  const alerts: string[] = [];
  if (judging.data) {
    for (const lane of ["official", "internal"]) for (const c of judging.data.lanes[lane].constraints as string[])
      if (/^(NO_WORKERS|OVER_TARGET|PAUSED|WARNING)/.test(c)) alerts.push(lane + ": " + c);
    for (const w of judging.data.workers) if (!w.online) alerts.push("Worker " + w.name + " is offline");
  }

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Control room</div><h1>Overview</h1><p>Everything happening now. Create things from the left menu.</p></div>
      </div>

      <div className="stat-tiles">
        {organizer && <Stat label="Live contests" value={runs ? runs.filter((r) => runPhase(now, r.starts_at, r.ends_at).phase === "live").length : "…"} tone="ok" />}
        {organizer && <Stat label="Waiting to judge" value={runs ? runs.reduce((n, r) => n + r.waiting, 0) : "…"} tone={runs && runs.some((r) => r.waiting > 10) ? "warn" : undefined} />}
        {organizer && <Stat label="Open questions" value={runs ? runs.reduce((n, r) => n + r.openQuestions, 0) : "…"} tone={runs && runs.some((r) => r.openQuestions) ? "warn" : undefined} />}
        {superAdmin && <Stat label="Judges online" value={judging.data ? `${judging.data.workers.filter((w: any) => w.online).length}/${judging.data.workers.length}` : "…"} tone={judging.data && judging.data.workers.some((w: any) => !w.online) ? "bad" : "ok"} />}
        {setter && <Stat label="Problems to approve" value={review.length} tone={review.length ? "warn" : undefined} />}
      </div>

      {alerts.length > 0 && <div className="notice warn"><strong>Needs attention</strong><ul className="small" style={{ margin: "0.4rem 0 0" }}>{alerts.map((a) => <li key={a}>{a}</li>)}</ul></div>}

      {organizer && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>Live and upcoming contests</h2>
          {runs === null ? <Loading /> : runs.length === 0 ? <Empty>No contest is running or scheduled. <a href="#/admin/contests/new">Create one</a>.</Empty> : (
            <div className="grid grid-2">
              {runs.map((r) => {
                const p = runPhase(now, r.starts_at, r.ends_at);
                return (
                  <div key={r.id} className={"card stack rise " + (p.phase === "live" ? "accent-ok" : "accent")}>
                    <div className="row-between">
                      <h3 style={{ margin: 0 }}>{r.competition.title}</h3>
                      <div className="row">{r.kind === "REHEARSAL" && <Badge tone="warn">Rehearsal</Badge>}{r.submissions_paused && <Badge tone="bad">Paused</Badge>}</div>
                    </div>
                    <div className="row">
                      {p.phase === "live" ? <><LiveDot /><Badge tone="ok">LIVE · left</Badge></> : p.phase === "upcoming" ? <Badge tone="info">Starts in</Badge> : <Badge>Ended</Badge>}
                      <span className="clock" style={{ fontSize: "1.1rem" }}>{p.phase === "ended" ? "" : clock(p.ms)}</span>
                    </div>
                    <div className="capacity-numbers">
                      <Stat label="Submissions" value={r.submissions >= 100 ? "100+" : r.submissions} />
                      <Stat label="Waiting" value={r.waiting} hint="queued or judging" />
                      <Stat label="Open questions" value={r.openQuestions} />
                    </div>
                    <div className="row">
                      <a className="btn primary small" href={"#/admin/contests/" + r.competition.id}>Open monitor</a>
                      {p.phase === "upcoming" && r.kind === "OFFICIAL" && <button className="small primary" onClick={() => setStartNow(r)}>▶ Start now</button>}
                      {p.phase === "live" && !r.submissions_paused && <button className="small danger" onClick={() => setPause(r)}>Pause submissions</button>}
                      <a className="btn small" href={"#/arena/" + r.id}>View arena</a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className="grid grid-2">
        {superAdmin && (
          <section className="card stack">
            <div className="row-between"><h3 style={{ margin: 0 }}>Judges</h3><a href="#/admin/judging" className="small">Settings →</a></div>
            {!judging.data ? <Loading /> : (["official", "internal"] as const).map((lane) => {
              const l = judging.data.lanes[lane];
              const q = judging.data.queue.databaseJobs[lane] ?? {};
              return (
                <div key={lane} className="stack" style={{ gap: "0.3rem" }}>
                  <div className="row-between small"><strong>{lane === "official" ? "Official contests" : "Practice & testing"}</strong>
                    <span>{l.running} running / {l.effectiveCapacity} slots · {(q.queued ?? 0) + (q.retry ?? 0)} waiting</span></div>
                  <Meter value={l.running} max={l.effectiveCapacity} />
                </div>
              );
            })}
            {judging.data && <span className="small muted">{judging.data.workers.filter((w: any) => w.online).length} of {judging.data.workers.length} workers online</span>}
          </section>
        )}
        {setter && (
          <section className="card stack">
            <div className="row-between"><h3 style={{ margin: 0 }}>Problems</h3><a href="#/admin/problems" className="small">All problems →</a></div>
            {problems.loading ? <Loading /> : (
              <>
                <div className="capacity-numbers">
                  <Stat label="Ready to approve" value={review.length} />
                  <Stat label="Drafts / testing" value={drafts.length} />
                  <Stat label="Approved" value={(problems.data ?? []).filter((p) => p.status === "APPROVED" || p.status === "PUBLISHED").length} />
                </div>
                {review.slice(0, 5).map((p) => <a key={p.version_id} href={"#/admin/problems/" + p.version_id} className="row-between card-flat"><span>{p.title}</span><Badge tone="warn">Review</Badge></a>)}
              </>
            )}
          </section>
        )}
      </div>
      {startNow && <ReasonDialog title={"Start now: " + startNow.competition.title} confirm="Start the contest"
        description={<>The contest starts immediately and ends after its configured duration ({Math.round((new Date(startNow.ends_at).getTime() - new Date(startNow.starts_at).getTime()) / 60000)} min). Registered entrants see the problems at once.</>}
        onClose={() => setStartNow(null)}
        onSubmit={(reason) => run(async () => { await post("/api/manage/runs/" + startNow.id + "/control", { action: "start-now", reason }); setStartNow(null); }, "Contest started")} />}
      {pause && <ReasonDialog title={"Pause submissions: " + pause.competition.title} danger onClose={() => setPause(null)}
        description="New submissions are refused; queued ones keep judging. The clock does not stop."
        onSubmit={(reason) => run(async () => { await post("/api/manage/runs/" + pause.id + "/control", { action: "pause", reason }); setPause(null); }, "Submissions paused")} />}
    </div>
  );
}
