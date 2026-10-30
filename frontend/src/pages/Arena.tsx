import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, post } from "../api";
import { navigate, useAction, useAuth, useData, useServerClock, useToast } from "../app";
import { ProblemStatement, SubmissionModal, SubmissionTable, SubmitPanel, pending, type ProblemDetail, type SubmissionRow } from "../components/Problem";
import Standings, { SCORING_INFO, firstSolves, totalOf, useBoard, type Board } from "../components/Standings";
import { Badge, ErrorBox, Field, LiveDot, Loading, Markdown, Ring, clock, timeOf, when } from "../ui";
import type { RunDetail } from "./Lobby";

type View = { kind: "problems" } | { kind: "problem"; slot: number } | { kind: "submissions" } | { kind: "scoreboard" } | { kind: "questions" };
type Clarification = { id: string; question: string; answer: string | null; is_public: boolean; created_at: string; answered_at: string | null };
type Announcement = { id: string; title: string; body_md: string; published_at: string };
type MyRun = { run_id: string; entry_id: string; entry_name: string; team_id: string | null; members: string | null };
type Status = { solved: boolean; attempts: number; pending: boolean; lastVerdict: string | null };

/** Fullscreen is a client-side deterrent only; it is not proctoring or anti-cheat. */
function useFullscreen(required: boolean) {
  const [active, setActive] = useState(() => Boolean(document.fullscreenElement));
  const [exits, setExits] = useState(0);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    const change = () => {
      const now = Boolean(document.fullscreenElement);
      setActive(now);
      if (!now && required) setExits((n) => n + 1);
    };
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, [required]);
  // If the browser refuses full screen (embedded frame, policy), never lock a contestant out.
  const enter = useCallback(() => {
    const request = document.documentElement.requestFullscreen?.();
    if (!request) { setDenied(true); return; }
    request.then(() => setDenied(false)).catch(() => setDenied(true));
  }, []);
  const leave = useCallback(() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined); }, []);
  return { active, exits, enter, leave, denied, supported: Boolean(document.documentElement.requestFullscreen) && document.fullscreenEnabled !== false };
}

export default function Arena({ runId }: { runId: string }) {
  const { me, organizer } = useAuth();
  const toast = useToast();
  const detail = useData<RunDetail>("/api/runs/" + runId, 20000);
  const mine = useData<MyRun[]>("/api/me/runs");
  const now = useServerClock();
  const [view, setView] = useState<View>({ kind: "problems" });
  const [problems, setProblems] = useState<Record<number, ProblemDetail>>({});
  const [openSubmission, setOpenSubmission] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const r = detail.data?.run;
  const start = r ? new Date(r.starts_at).getTime() : 0, end = r ? new Date(r.ends_at).getTime() : 0;
  const phase = !r ? "loading" : now < start ? "upcoming" : now < end && r.status !== "FINISHED" ? "live" : "ended";
  const entry = mine.data?.find((m) => m.run_id === runId);
  const isTeam = detail.data?.configuration.mode === "TEAM";
  const scoring = (detail.data?.configuration.scoring_system ?? "ICPC") as keyof typeof SCORING_INFO;
  const fullscreen = useFullscreen(phase === "live" && Boolean(entry));

  // Problems are withheld until the start; refetch the run as soon as the clock passes it.
  const reloadRun = detail.reload;
  useEffect(() => {
    if (phase !== "live" || detail.data?.problems) return;
    reloadRun();
    // A small clock difference can reach the server just before the start, so keep trying until they arrive.
    const timer = setInterval(reloadRun, 1000);
    return () => clearInterval(timer);
  }, [phase, detail.data?.problems, reloadRun]);
  const slot = view.kind === "problem" ? view.slot : null;
  useEffect(() => {
    if (slot === null || problems[slot] || phase === "upcoming") return;
    get<ProblemDetail>("/api/runs/" + runId + "/problems/" + slot)
      .then((p) => setProblems((all) => ({ ...all, [slot]: p })))
      .catch((e) => toast("error", e.message));
  }, [slot, problems, runId, phase, toast]);

  const submissions = useData<SubmissionRow[]>(phase === "loading" ? null : "/api/submissions?run=" + runId, 0);
  const anyPending = (submissions.data ?? []).some(pending);
  const reloadSubmissions = submissions.reload;
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") reloadSubmissions(); }, anyPending ? 2000 : 10000);
    return () => clearInterval(timer);
  }, [anyPending, reloadSubmissions]);
  const board = useBoard(runId, false, view.kind === "scoreboard" ? 5000 : 15000);

  const labels = useMemo(() => Object.fromEntries((detail.data?.problems ?? []).map((p) => [p.slot, p.label])), [detail.data?.problems]);
  // Verdict notifications, for the whole team.
  const seen = useRef<Record<string, string | null>>({});
  useEffect(() => {
    for (const s of submissions.data ?? []) {
      const before = seen.current[s.id];
      if (before === null && s.verdict) {
        const who = isTeam && s.submitted_by_handle && s.submitted_by_handle !== me?.handle ? "@" + s.submitted_by_handle + " — " : "";
        toast(s.verdict === "ACCEPTED" ? "success" : "info", `${who}Problem ${labels[s.problem_slot ?? -1] ?? "?"}: ${s.verdict.replace(/_/g, " ").toLowerCase()}`);
      }
      seen.current[s.id] = s.verdict;
    }
  }, [submissions.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const announcements = useData<Announcement[]>(phase === "loading" ? null : "/api/runs/" + runId + "/announcements");
  const clarifications = useData<Clarification[]>(phase === "loading" ? null : "/api/runs/" + runId + "/clarifications");
  useEffect(() => {
    if (phase === "loading") return;
    let cancelled = false, cursor = 0, first = true;
    const poll = async () => {
      try {
        const events = await get<{ id: number; kind: string }[]>("/api/runs/" + runId + "/events?after=" + cursor);
        if (cancelled || events.length === 0) { first = false; return; }
        if (!first) {
          if (events.some((e) => e.kind === "ANNOUNCEMENT")) { announcements.reload(); toast("info", "New announcement from the organizers"); setUnread((n) => n + 1); }
          if (events.some((e) => e.kind === "CLARIFICATION_UPDATED")) { clarifications.reload(); setUnread((n) => n + 1); }
          if (events.some((e) => e.kind === "SUBMISSION_JUDGED")) reloadSubmissions();
          // Started, extended, paused, ended or results released by the organizers.
          if (events.some((e) => e.kind === "RUN_UPDATED")) { reloadRun(); board.reload(); }
        }
        cursor = events[events.length - 1].id; first = false;
      } catch { /* transient; next poll retries */ }
    };
    poll();
    const timer = setInterval(() => { if (document.visibilityState === "visible") poll(); }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [phase, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = useMemo(() => {
    const result: Record<number, Status> = {};
    for (const s of [...(submissions.data ?? [])].reverse()) {
      if (s.problem_slot == null) continue;
      const st = (result[s.problem_slot] ??= { solved: false, attempts: 0, pending: false, lastVerdict: null });
      if (pending(s)) st.pending = true;
      if (s.verdict && s.verdict !== "JUDGE_ERROR") { st.attempts++; st.lastVerdict = s.verdict; }
      if (s.verdict === "ACCEPTED") st.solved = true;
    }
    return result;
  }, [submissions.data]);
  const myRow = board.data?.standings.find((row) => row.entry === entry?.entry_id);

  if (detail.loading) return <Loading label="Opening the arena…" />;
  if (!detail.data || !r) return <main className="page"><ErrorBox error={detail.error} /><a href="#/">Back</a></main>;
  const remaining = end - now;
  const problemList = detail.data.problems ?? [];
  const solvedCount = Object.values(status).filter((s) => s.solved).length;
  const exit = () => { fullscreen.leave(); navigate(organizer && !entry ? "/admin" : "/run/" + runId); };

  return (
    <div className="arena">
      <header className="arena-bar">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); exit(); }}><img src="/logo.png" alt="" /><span>INFO<b>M4TH</b></span></a>
        <div className="stack" style={{ gap: 0, minWidth: 0 }}>
          <strong className="small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{detail.data.configuration.title ?? "Contest"}</strong>
          <span className="small" style={{ color: "#9fc6d1" }}>{entry ? (isTeam ? `Team ${entry.entry_name} · ${entry.members}` : entry.entry_name) : organizer ? "Jury preview — you are not competing" : "Spectator"}</span>
        </div>
        {r.kind === "REHEARSAL" && <Badge tone="warn">Rehearsal</Badge>}
        {r.submissions_paused && <Badge tone="warn">Submissions paused</Badge>}
        {fullscreen.denied && !fullscreen.active && <Badge tone="warn">Full screen blocked by this browser</Badge>}
        <div className="spacer" />
        {phase === "live" && <span className={"clock" + (remaining < 15 * 60_000 ? " low" : "")} title="Time remaining (server clock)">{clock(remaining)}</span>}
        {phase === "ended" && <span className="clock">Contest over</span>}
        <div className="spacer" />
        {phase !== "upcoming" && <span className="small">{scoring === "ICPC" ? `${solvedCount}/${problemList.length} solved` : `${myRow ? Number(myRow.score.toFixed(2)) : 0} points`}{myRow ? ` · rank ${myRow.rank}` : ""}</span>}
        {fullscreen.supported && !fullscreen.active && <button className="small" onClick={fullscreen.enter}>Full screen</button>}
        <button className="small" onClick={exit}>Exit</button>
      </header>

      {phase === "upcoming" ? (
        <div className="lock-screen" style={{ position: "static", minHeight: "calc(100vh - 56px)" }}>
          <div className="stack" style={{ alignItems: "center" }}>
            <div className="eyebrow" style={{ color: "#35c7e8" }}>The contest starts in</div>
            <div className="countdown">{clock(start - now)}</div>
            <p style={{ maxWidth: 560 }}>Problems appear automatically at {when(r.starts_at)}. Scoring: <strong>{SCORING_INFO[scoring]?.name}</strong> — {SCORING_INFO[scoring]?.summary}</p>
            {entry ? <p>{isTeam ? <>You compete as team <strong>{entry.entry_name}</strong> ({entry.members}). Everyone in the team can submit; results are shared.</> : "You are registered."}</p> : <p>You are not registered for this contest.</p>}
            {fullscreen.supported && !fullscreen.active && entry && <button className="primary" onClick={fullscreen.enter}>Enter full screen now</button>}
          </div>
        </div>
      ) : (
        <div className="arena-main">
          <nav className="arena-tabs" aria-label="Arena">
            <button className={view.kind === "problems" ? "active" : ""} onClick={() => setView({ kind: "problems" })}>Problems</button>
            {problemList.map((p) => (
              <button key={p.slot} className={"chip-tab " + (slot === p.slot ? "active " : "") + (status[p.slot]?.solved ? "solved" : status[p.slot]?.attempts ? "tried" : "")}
                onClick={() => setView({ kind: "problem", slot: p.slot })} title={p.title}>{p.label}</button>
            ))}
            <span className="spacer" />
            <button className={view.kind === "submissions" ? "active" : ""} onClick={() => setView({ kind: "submissions" })}>{isTeam ? "Team submissions" : "My submissions"}{anyPending ? " •" : ""}</button>
            <button className={view.kind === "scoreboard" ? "active" : ""} onClick={() => setView({ kind: "scoreboard" })}>Scoreboard</button>
            <button className={view.kind === "questions" ? "active" : ""} onClick={() => { setView({ kind: "questions" }); setUnread(0); }}>Questions{unread > 0 ? ` (${unread})` : ""}</button>
          </nav>

          {view.kind === "problems" && (
            <section className="arena-page">
             <div className="arena-split">
             <div>
              <table className="problem-table">
                <thead><tr><th>#</th><th>Problem</th><th>Limits</th>{scoring !== "ICPC" && <th className="right">Points</th>}<th>Solved by</th><th>{isTeam ? "Your team" : "You"}</th></tr></thead>
                <tbody>
                  {problemList.map((p) => {
                    const st = status[p.slot];
                    const stat = board.data?.problemStats.find((x) => x.slot === p.slot);
                    const cell = myRow?.problems.find((c) => c.slot === p.slot);
                    const points = board.data?.problems.find((x) => x.slot === p.slot)?.points;
                    return (
                      <tr key={p.slot} className={st?.solved ? "row-solved" : st?.attempts ? "row-tried" : ""} onClick={() => setView({ kind: "problem", slot: p.slot })}>
                        <td><span className={"problem-letter " + (st?.solved ? "solved" : st?.attempts ? "tried" : "")}>{p.label}</span></td>
                        <td><strong>{p.title}</strong></td>
                        <td className="small muted">{p.time_limit_ms / 1000} s · {p.memory_limit_mb} MB</td>
                        {scoring !== "ICPC" && <td className="right mono">{points ?? "—"}</td>}
                        <td title={stat ? `${stat.solved} solved, ${stat.tried} tried` : ""}>
                          <div className="solve-rate">
                            <span className="small"><span className="mono">✓ {stat?.solved ?? 0}</span> <span className="muted">/ {stat?.tried ?? 0} tried</span></span>
                            <div className="bar ok"><div style={{ width: (stat && board.data?.standings.length ? (100 * stat.solved) / board.data.standings.length : 0) + "%" }} /></div>
                          </div>
                        </td>
                        <td>
                          {st?.pending && <Badge tone="info">Judging…</Badge>}{" "}
                          {st?.solved ? <Badge tone="ok">{scoring === "ICPC" ? `Solved${st.attempts > 1 ? ` (+${st.attempts - 1})` : ""}` : `${cell ? Number(cell.score.toFixed(2)) : "?"} pts`}</Badge>
                            : st?.attempts ? <Badge tone={scoring === "IOI" && cell && cell.score > 0 ? "warn" : "bad"}>{scoring === "IOI" && cell && cell.score > 0 ? `${Number(cell.score.toFixed(2))} pts` : `−${st.attempts}`}</Badge>
                            : <span className="small muted">not tried</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="small muted">Click a problem to open it. {SCORING_INFO[scoring]?.summary} “Solved by” counts {isTeam ? "teams" : "contestants"} that solved / tried the problem{board.data?.frozen ? " (frozen near the end)" : ""}.</p>
             </div>
             <ContestPulse board={board.data} me={entry?.entry_id} start={start} end={end} now={now} labels={labels}
               attempts={(submissions.data ?? []).filter((s) => s.verdict && s.verdict !== "JUDGE_ERROR").length} onScoreboard={() => setView({ kind: "scoreboard" })} />
             </div>
            </section>
          )}

          {view.kind === "problem" && slot !== null && (
            <div className="arena-body">
              <section className="arena-pane">
                {problems[slot] ? <ProblemStatement problem={problems[slot]} label={labels[slot]} /> : <Loading label="Loading statement…" />}
              </section>
              <section className="arena-pane editor-pane" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <SubmitPanel
                  scope={runId + "." + slot}
                  languages={problems[slot]?.languages ?? []}
                  path={"/api/runs/" + runId + "/problems/" + slot + "/submissions"}
                  disabled={phase !== "live" || r.submissions_paused || !entry}
                  disabledReason={!entry ? "You are not an entrant of this contest." : phase !== "live" ? "The contest is over." : "Organizers paused submissions. Keep working; submit when resumed."}
                  onSubmitted={() => submissions.reload()}
                />
                <div>
                  <strong className="small">Submissions for {labels[slot]}</strong>
                  <SubmissionTable rows={(submissions.data ?? []).filter((s) => s.problem_slot === slot)} onOpen={setOpenSubmission} showAuthor={isTeam} />
                </div>
              </section>
            </div>
          )}

          {view.kind === "submissions" && <section className="arena-page"><SubmissionTable rows={submissions.data ?? []} labels={labels} onOpen={setOpenSubmission} showAuthor={isTeam} /></section>}
          {view.kind === "scoreboard" && <section className="arena-page"><Standings runId={runId} me={entry?.entry_id} /></section>}
          {view.kind === "questions" && (
            <section className="arena-page">
              <Questions runId={runId} labels={labels} slot={null} canAsk={phase === "live" && Boolean(entry)}
                announcements={announcements.data ?? []} clarifications={clarifications.data ?? []} reload={clarifications.reload} problems={problemList} />
            </section>
          )}
        </div>
      )}

      {phase === "live" && entry && fullscreen.supported && !fullscreen.active && !fullscreen.denied && (
        <div className="lock-screen">
          <div className="card stack" style={{ alignItems: "center" }}>
            <h2>Full screen required</h2>
            <p>The arena runs in full screen during the contest.{fullscreen.exits > 0 && <> You left full screen <strong>{fullscreen.exits}</strong> time{fullscreen.exits > 1 ? "s" : ""}.</>} Your code and drafts are safe.</p>
            <button className="primary" onClick={fullscreen.enter}>Return to full screen</button>
            <span className="small" style={{ color: "#a9c4cc" }}>Time remaining {clock(remaining)}</span>
          </div>
        </div>
      )}
      {openSubmission && <SubmissionModal id={openSubmission} onClose={() => setOpenSubmission(null)} />}
    </div>
  );
}

/** Side panel that keeps the problems page alive: time, own progress, leaders and recent solves. */
function ContestPulse({ board, me, start, end, now, labels, attempts, onScoreboard }: {
  board?: Board; me?: string; start: number; end: number; now: number; labels: Record<number, string>; attempts: number; onScoreboard: () => void;
}) {
  const names = Object.fromEntries((board?.entries ?? []).map((e) => [e.id, e.display_name]));
  const mine = board?.standings.find((r) => r.entry === me);
  const first = board ? firstSolves(board) : {};
  const feed = (board?.standings ?? []).flatMap((row) => row.problems.filter((c) => c.solved && !c.frozen).map((c) => ({ row, c })))
    .sort((a, b) => b.c.solveSeconds - a.c.solveSeconds).slice(0, 14);
  const elapsed = Math.min(end - start, Math.max(0, now - start));
  return (
    <aside className="pulse-panel">
      <div className="card row" style={{ gap: "1rem", flexWrap: "nowrap" }}>
        <Ring value={elapsed} max={end - start}><span className="muted">left</span><strong>{clock(end - now).slice(0, 5)}</strong></Ring>
        <div className="stack" style={{ gap: "0.35rem" }}>
          <div className="small muted">Your progress</div>
          <div><strong style={{ fontSize: "1.5rem", fontFamily: "var(--font-display)" }}>{mine ? "#" + mine.rank : "—"}</strong><span className="small muted"> of {board?.standings.length ?? 0}</span></div>
          <div className="small">{board && mine ? totalOf(board, mine) + (board.scoring === "ICPC" ? " solved" : " points") : "No points yet"} · {attempts} judged</div>
        </div>
      </div>
      <div className="card">
        <div className="row-between" style={{ marginBottom: "0.5rem" }}><strong>Leaders</strong><button className="small ghost" onClick={onScoreboard}>Full scoreboard →</button></div>
        {!board?.standings.length ? <div className="small muted">Nobody yet.</div> : (
          <table className="mini-board"><tbody>
            {board.standings.slice(0, 5).map((r) => (
              <tr key={r.entry} className={r.entry === me ? "me" : ""}><td style={{ width: 28 }}>{r.rank}</td><td>{names[r.entry]}</td><td className="right mono">{totalOf(board, r)}</td></tr>
            ))}
            {mine && mine.rank > 5 && <tr className="me"><td>{mine.rank}</td><td>{names[mine.entry]}</td><td className="right mono">{totalOf(board, mine)}</td></tr>}
          </tbody></table>
        )}
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: "0.5rem" }}><LiveDot /><strong>Live feed</strong></div>
        {feed.length === 0 ? <div className="small muted">No problem solved yet. Be the first!</div> : (
          <ul className="feed">
            {feed.map(({ row, c }) => {
              const isFirst = first[c.slot] === c.solveSeconds;
              return (
                <li key={row.entry + c.slot} className={(isFirst ? "first " : "") + (row.entry === me ? "mine" : "")}>
                  <time>{Math.floor(c.solveSeconds / 60)}′</time>
                  <span><strong>{names[row.entry]}</strong> solved {labels[c.slot] ?? c.slot}{isFirst ? " — first!" : ""}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function Questions({ runId, labels, canAsk, announcements, clarifications, reload, problems }: {
  runId: string; labels: Record<number, string>; slot: number | null; canAsk: boolean;
  announcements: Announcement[]; clarifications: Clarification[]; reload: () => void; problems: { slot: number; label: string; title: string }[];
}) {
  const [question, setQuestion] = useState("");
  const [about, setAbout] = useState("");
  const { busy, run } = useAction();
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="stack">
        {canAsk && (
          <form className="card-flat stack" onSubmit={(e) => {
            e.preventDefault();
            const text = (about ? `[Problem ${labels[Number(about)] ?? about}] ` : "[General] ") + question.trim();
            run(async () => { await post("/api/runs/" + runId + "/clarifications", { question: text }); setQuestion(""); reload(); }, "Question sent to the jury");
          }}>
            <strong>Ask the jury</strong>
            <Field label="About"><select value={about} onChange={(e) => setAbout(e.target.value)}><option value="">General</option>{problems.map((p) => <option key={p.slot} value={p.slot}>{p.label}. {p.title}</option>)}</select></Field>
            <Field label="Question" hint="Ask about the statement only. The jury does not help debug code.">
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={8000} required />
            </Field>
            <div><button className="primary" disabled={busy || !question.trim()}>Send question</button></div>
          </form>
        )}
        <h3 style={{ margin: 0 }}>Clarifications</h3>
        {clarifications.length === 0 ? <div className="empty">No clarifications yet.</div> : clarifications.map((c) => (
          <div key={c.id} className="card-flat">
            <div className="row-between small muted"><span>{c.is_public ? "Answered for everyone" : "Your question"}</span><span>{timeOf(c.created_at)}</span></div>
            <p style={{ margin: "0.25rem 0" }}><strong>Q:</strong> {c.question}</p>
            {c.answer ? <p style={{ margin: 0 }}><strong>A:</strong> {c.answer}</p> : <Badge>Waiting for the jury</Badge>}
          </div>
        ))}
      </div>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Announcements</h3>
        {announcements.length === 0 ? <div className="empty">No announcements.</div> : [...announcements].reverse().map((a) => (
          <div key={a.id} className="notice">
            <div className="row-between"><strong>{a.title}</strong><span className="small muted">{timeOf(a.published_at)}</span></div>
            <Markdown text={a.body_md} />
          </div>
        ))}
      </div>
    </div>
  );
}
