import { useCallback, useEffect, useRef, useState } from "react";
import { get, post, serverNow } from "../api";
import { navigate, useAction, useAuth, useData, useServerClock, useToast } from "../app";
import { ProblemStatement, SubmissionModal, TestCases, draftKey, readDraft, templateFor, uuid,
  type ProblemDetail, type SubmissionDetail } from "../components/Problem";
import { CodeEditor, Empty, ErrorBox, LANGUAGE_NAMES, Loading, VERDICTS, Verdict, ago } from "../ui";
import { parseSignature } from "../lib/functionMode";
import { DifficultyPill } from "./Practice";
import { Avatar } from "../components/Avatar";

type Duel = {
  id: string; status: "WAITING" | "ACTIVE" | "FINISHED" | "CANCELLED";
  created_by: string; opponent_id: string | null; creator_handle: string; creator_name: string;
  opponent_handle: string | null; opponent_name: string | null; winner_handle: string | null;
  rounds_to_win: number; round_seconds: number; lockout_seconds: number; difficulty: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
  end_reason: "ROUNDS" | "FORFEIT" | "DRAW" | "EXPIRED" | null;
  creator_wins?: number; opponent_wins?: number;
};
type Round = {
  number: number; starts_at: string | null; ends_at: string | null; result: "ACCEPTED" | "TESTS" | "DRAW" | "FORFEIT" | null;
  winner_handle: string | null; problem_version_id: string | null; title: string | null; difficulty: string | null;
};
type FeedItem = {
  id?: string; duel_round: number; handle: string; submitted_at: string; language_code: string; mine: boolean;
  status: string | null; verdict: string | null; passed_tests: number | null; total_tests: number | null;
};
type DuelState = { serverTime: number; duel: Duel; role: "CREATOR" | "OPPONENT" | "SPECTATOR"; rounds: Round[]; feed: FeedItem[]; lockedSeconds?: number };
type Lists = { mine: Duel[]; open: Duel[]; live: Duel[] };

const bestOf = (d: Duel) => d.rounds_to_win * 2 - 1;
const settings = (d: Duel) => `Best of ${bestOf(d)} · ${d.round_seconds / 60} min rounds${d.difficulty ? " · " + d.difficulty.toLowerCase() : ""}`;
const pendingVerdict = (s: { status: string | null; verdict: string | null }) => !s.verdict && s.status !== "FAILED";
const RESULT_TEXT: Record<string, string> = { ACCEPTED: "first accepted", TESTS: "most tests passed", FORFEIT: "forfeit", DRAW: "draw" };

// ---------- Hub: create a challenge, accept one, watch live duels ----------
export function DuelHub() {
  const lists = useData<Lists>("/api/duels", 4000);
  const { me } = useAuth();
  const { busy, run } = useAction();
  const [form, setForm] = useState({ bestOf: 3, roundMinutes: 5, lockoutSeconds: 15, difficulty: "" });
  const create = async () => {
    const r = await run(() => post<{ duelId: string }>("/api/duels", { ...form, difficulty: form.difficulty || null }));
    if (r) navigate("/duel/" + r.duelId);
  };
  const accept = async (id: string) => {
    if (await run(() => post("/api/duels/" + id + "/join"))) navigate("/duel/" + id);
  };
  const mine = lists.data?.mine ?? [];
  const current = mine.find((d) => d.status === "ACTIVE" || d.status === "WAITING");
  const history = mine.filter((d) => d.status === "FINISHED");

  return (
    <main className="page page-wide">
      <section className="practice-hero duel-hero">
        <div className="stack" style={{ gap: "0.4rem" }}>
          <div className="eyebrow">⚔ Blitz duels</div>
          <h1 style={{ margin: 0 }}>Duel another player</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 600 }}>Short rounds, one problem each. The first accepted answer wins the round;
            if time runs out, the most tests passed wins it. A wrong answer locks you out for a few seconds. You see your opponent's verdicts live, never their code.</p>
        </div>
        <div className="card duel-create">
          <strong>New challenge</strong>
          <div className="filters">
            {[1, 3, 5].map((n) => <button key={n} className={form.bestOf === n ? "active" : ""} onClick={() => setForm({ ...form, bestOf: n })}>Best of {n}</button>)}
          </div>
          <div className="row">
            <label className="small">Round <select value={form.roundMinutes} onChange={(e) => setForm({ ...form, roundMinutes: Number(e.target.value) })} style={{ width: "auto" }}>
              {[2, 3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
            <label className="small">Penalty <select value={form.lockoutSeconds} onChange={(e) => setForm({ ...form, lockoutSeconds: Number(e.target.value) })} style={{ width: "auto" }}>
              {[0, 10, 15, 30, 60].map((s) => <option key={s} value={s}>{s ? s + " s" : "none"}</option>)}</select></label>
            <label className="small">Level <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} style={{ width: "auto" }}>
              <option value="">Mixed</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></select></label>
          </div>
          <button className="primary" disabled={busy || Boolean(current)} onClick={create} title={current ? "Finish or cancel your current duel first" : ""}>Create challenge</button>
        </div>
      </section>

      <ErrorBox error={lists.error} />
      {current && (
        <div className="notice ok row-between">
          <span>{current.status === "WAITING" ? "Your challenge is waiting for an opponent."
            : `Your duel against @${current.creator_handle === me?.handle ? current.opponent_handle : current.creator_handle} is running.`}</span>
          <a className="btn primary small" href={"#/duel/" + current.id}>{current.status === "WAITING" ? "Open" : "Back to the duel"}</a>
        </div>
      )}
      {lists.loading ? <Loading /> : (
        <div className="duel-columns">
          <section className="stack">
            <h3 style={{ margin: 0 }}>Open challenges</h3>
            {(lists.data?.open ?? []).length === 0 ? <Empty>No open challenge right now. Create one and share its link.</Empty> :
              lists.data!.open.map((d) => (
                <div key={d.id} className="card duel-row">
                  <Avatar handle={d.creator_handle} size={34} />
                  <div className="stack" style={{ gap: 0, flex: 1 }}><strong>@{d.creator_handle}</strong><span className="small muted">{settings(d)} · {ago(d.created_at)}</span></div>
                  <button className="primary small" disabled={busy || Boolean(current)} onClick={() => accept(d.id)}>Accept ⚔</button>
                </div>
              ))}
            <h3 style={{ margin: "1rem 0 0" }}>Live now</h3>
            {(lists.data?.live ?? []).length === 0 ? <Empty>No duel is being played.</Empty> :
              lists.data!.live.map((d) => (
                <a key={d.id} className="card duel-row" href={"#/duel/" + d.id}>
                  <span className="live-dot" aria-hidden />
                  <strong style={{ flex: 1 }}>@{d.creator_handle} <span className="mono">{d.creator_wins}–{d.opponent_wins}</span> @{d.opponent_handle}</strong>
                  <span className="small muted">Watch ›</span>
                </a>
              ))}
          </section>
          <section className="stack">
            <h3 style={{ margin: 0 }}>Your duels</h3>
            {history.length === 0 ? <Empty>Your finished duels appear here.</Empty> : (
              <div className="card table-wrap" style={{ padding: 0 }}>
                <table>
                  <tbody>
                    {history.map((d) => <HistoryRow key={d.id} duel={d} />)}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function HistoryRow({ duel: d }: { duel: Duel }) {
  const { me } = useAuth();
  const iAmCreator = d.creator_handle === me?.handle;
  const opponent = iAmCreator ? d.opponent_handle : d.creator_handle;
  const mine = iAmCreator ? d.creator_wins : d.opponent_wins, theirs = iAmCreator ? d.opponent_wins : d.creator_wins;
  const outcome = !d.winner_handle ? "draw" : d.winner_handle === me?.handle ? "win" : "loss";
  return (
    <tr onClick={() => navigate("/duel/" + d.id)} style={{ cursor: "pointer" }}>
      <td><span className={"duel-outcome " + outcome}>{outcome === "win" ? "Won" : outcome === "loss" ? "Lost" : "Draw"}</span></td>
      <td>vs <strong>@{opponent}</strong>{d.end_reason === "FORFEIT" && <span className="small muted"> (forfeit)</span>}</td>
      <td className="mono">{mine}–{theirs}</td>
      <td className="small muted right">{ago(d.finished_at)}</td>
    </tr>
  );
}

// ---------- Room: one duel, for players and spectators ----------
export function DuelRoom({ id }: { id: string }) {
  const state = useData<DuelState>("/api/duels/" + id, 1000);
  const { me } = useAuth();
  const toast = useToast();
  const now = useServerClock();
  const { busy, run } = useAction();
  // Announce the opponent's verdicts as they land: that is where the tension is.
  const seen = useRef<Set<string> | null>(null);
  const feed = state.data?.feed;
  useEffect(() => {
    if (!feed || state.data?.role === "SPECTATOR") return;
    const keys = feed.filter((f) => !f.mine && f.verdict).map((f) => f.submitted_at + f.handle);
    if (seen.current) {
      for (const f of feed) if (!f.mine && f.verdict && !seen.current.has(f.submitted_at + f.handle))
        toast(f.verdict === "ACCEPTED" ? "error" : "info", `⚔ @${f.handle}: ${VERDICTS[f.verdict]?.label ?? f.verdict}${f.total_tests ? ` (${f.passed_tests}/${f.total_tests})` : ""}`);
    }
    seen.current = new Set(keys);
  }, [feed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.loading) return <Loading label="Entering the duel…" />;
  if (!state.data) return <main className="page"><ErrorBox error={state.error} /><a href="#/duels">← Duels</a></main>;
  const { duel: d, role, rounds } = state.data;
  const player = role !== "SPECTATOR";
  const score = (handle: string | null) => rounds.filter((r) => r.winner_handle && r.winner_handle === handle).length;
  const leave = async () => {
    const text = d.status === "WAITING" ? "Cancel this challenge?" : "Forfeit the duel? Your opponent wins.";
    if (confirm(text) && await run(() => post("/api/duels/" + id + "/leave"))) state.reload();
  };

  if (d.status === "WAITING" || d.status === "CANCELLED") return <WaitingRoom state={state.data} onLeave={leave} onJoined={state.reload} busy={busy} />;

  const current = rounds.find((r) => !r.result && r.starts_at);
  const counting = current?.starts_at && Date.parse(current.starts_at) > now;
  const lastDecided = [...rounds].reverse().find((r) => r.result);
  const header = (
    <div className="duel-board">
      <PlayerSide handle={d.creator_handle} wins={score(d.creator_handle)} toWin={d.rounds_to_win} you={d.creator_handle === me?.handle} />
      <div className="duel-center">
        <div className="duel-rounds">
          {rounds.map((r) => (
            <span key={r.number} title={r.result ? `Round ${r.number}: ${r.winner_handle ? "@" + r.winner_handle : "draw"} (${RESULT_TEXT[r.result]})` : `Round ${r.number}`}
              className={"duel-dot" + (r.result ? (r.winner_handle === d.creator_handle ? " left" : r.winner_handle ? " right" : " draw") : r === current ? " now" : "")} />
          ))}
        </div>
        {d.status === "ACTIVE" && current?.ends_at && !counting && (
          <div className={"duel-clock mono" + (Date.parse(current.ends_at) - now < 30000 ? " hurry" : "")}>{mmss(Date.parse(current.ends_at) - now)}</div>
        )}
        {d.status === "ACTIVE" && counting && <div className="duel-clock mono">Round {current!.number}</div>}
        {d.status === "FINISHED" && <div className="duel-clock">Final</div>}
        <div className="small muted">{settings(d)}</div>
      </div>
      <PlayerSide handle={d.opponent_handle!} wins={score(d.opponent_handle)} toWin={d.rounds_to_win} you={d.opponent_handle === me?.handle} right />
    </div>
  );

  if (d.status === "FINISHED") return <main className="page page-wide">{header}<FinishedDuel state={state.data} /></main>;

  return (
    <div className="duel-room">
      <div className="duel-top">
        <a href="#/duels" className="small">← Duels</a>
        {header}
        {player ? <button className="ghost small" disabled={busy} onClick={leave}>Forfeit</button> : <span className="badge info">Spectating</span>}
      </div>
      {!current ? <Loading label="Deciding the round…" /> : counting ? (
        <div className="duel-countdown">
          {lastDecided && <div className="duel-last">Round {lastDecided.number}: {lastDecided.winner_handle ? <><strong>@{lastDecided.winner_handle}</strong> wins ({RESULT_TEXT[lastDecided.result!]})</> : "draw: nobody passed a test"}</div>}
          <div className="eyebrow">Round {current.number} starts in</div>
          <div className="duel-big mono">{Math.max(1, Math.ceil((Date.parse(current.starts_at!) - now) / 1000))}</div>
        </div>
      ) : (
        <RoundWorkspace key={current.number} duelId={id} round={current} state={state.data} player={player} onSubmitted={state.reload} />
      )}
    </div>
  );
}

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

function PlayerSide({ handle, wins, toWin, you, right }: { handle: string; wins: number; toWin: number; you: boolean; right?: boolean }) {
  return (
    <div className={"duel-player" + (right ? " right" : "")}>
      <Avatar handle={handle} size={40} />
      <div className="stack" style={{ gap: 0 }}>
        <strong>@{handle}{you && <span className="small muted"> (you)</span>}</strong>
        <span className="duel-pips">{Array.from({ length: toWin }, (_, i) => <span key={i} className={i < wins ? "on" : ""} />)}</span>
      </div>
      <span className="duel-score mono">{wins}</span>
    </div>
  );
}

function WaitingRoom({ state, onLeave, onJoined, busy }: { state: DuelState; onLeave: () => void; onJoined: () => void; busy: boolean }) {
  const { duel: d, role } = state;
  const { run, busy: joining } = useAction();
  const link = window.location.origin + window.location.pathname + "#/duel/" + d.id;
  if (d.status === "CANCELLED") return <main className="page"><Empty>This challenge was {d.end_reason === "EXPIRED" ? "not accepted within an hour" : "cancelled"}. <a href="#/duels">Back to duels</a></Empty></main>;
  return (
    <main className="page">
      <div className="card duel-waiting">
        <div className="eyebrow">⚔ Challenge</div>
        <h1 style={{ margin: 0 }}>@{d.creator_handle} wants to duel</h1>
        <p className="muted">{settings(d)} · {d.lockout_seconds ? `${d.lockout_seconds} s penalty after a wrong answer` : "no wrong-answer penalty"}</p>
        {role === "CREATOR" ? (
          <>
            <div className="row"><span className="spinner" /><strong>Waiting for an opponent…</strong></div>
            <p className="small muted">Send this link to someone, or wait for a player to accept it from the open challenges list.</p>
            <div className="row">
              <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
              <button onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
            </div>
            <button className="ghost small" disabled={busy} onClick={onLeave}>Cancel challenge</button>
          </>
        ) : (
          <button className="primary" disabled={joining} onClick={async () => { if (await run(() => post("/api/duels/" + d.id + "/join"))) onJoined(); }}>Accept the challenge ⚔</button>
        )}
      </div>
    </main>
  );
}

/** Statement, editor and live feed for the round being played. */
function RoundWorkspace({ duelId, round, state, player, onSubmitted }: { duelId: string; round: Round; state: DuelState; player: boolean; onSubmitted: () => void }) {
  const problem = useData<ProblemDetail>("/api/duels/" + duelId + "/rounds/" + round.number);
  const toast = useToast();
  const [language, setLanguage] = useState("CPP");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<"run" | "submit" | null>(null);
  const [run, setRun] = useState<{ id: string; detail?: SubmissionDetail } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const keys = useRef({ run: uuid(), submit: uuid() });
  // The penalty is counted down locally from the server's figure, refreshed every poll.
  const [lockedUntil, setLockedUntil] = useState(0);
  useEffect(() => { setLockedUntil(serverNow() + (state.lockedSeconds ?? 0) * 1000); }, [state.lockedSeconds, state.serverTime]);
  const now = useServerClock();
  const languages = problem.data?.languages ?? [];
  const scope = "duel." + duelId + "." + round.number;

  useEffect(() => {
    if (!languages.length) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("cp.language"); } catch { /* ignore */ }
    setLanguage((c) => (languages.includes(c) ? c : saved && languages.includes(saved) ? saved : languages[0]));
  }, [languages.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = Boolean(problem.data);
  const template = templateFor(language, parseSignature(problem.data?.function_signature));
  useEffect(() => { if (loaded) setSource(readDraft(scope, language) ?? template); }, [scope, language, template, loaded]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => { try { localStorage.setItem(draftKey(scope, language), source); } catch { /* ignore */ } }, 400);
    return () => clearTimeout(timer);
  }, [scope, language, source, loaded]);

  // "Run examples" goes through practice (round problems are practice problems) and never counts.
  const runId = run?.id, runDone = Boolean(run?.detail?.judging[0]?.verdict) || run?.detail?.judging[0]?.status === "FAILED";
  useEffect(() => {
    if (!runId || runDone) return;
    const timer = setInterval(async () => {
      try { const detail = await get<SubmissionDetail>("/api/submissions/" + runId); setRun((r) => (r?.id === runId ? { ...r, detail } : r)); } catch { /* retried */ }
    }, 1000);
    return () => clearInterval(timer);
  }, [runId, runDone]);

  const roundFeed = state.feed.filter((f) => f.duel_round === round.number);
  const myFeed = roundFeed.filter((f) => f.mine);
  const waiting = myFeed.some(pendingVerdict);
  const solved = myFeed.some((f) => f.verdict === "ACCEPTED");
  const locked = lockedUntil > now;

  const send = useCallback(async (kind: "run" | "submit") => {
    if (busy || !source.trim() || !round.problem_version_id) return;
    setBusy(kind);
    try {
      if (kind === "run") {
        const r = await post<{ submissionId: string }>("/api/practice/" + round.problem_version_id + "/submissions", { language, sourceCode: source, mode: "samples" }, keys.current.run);
        setRun({ id: r.submissionId });
      } else {
        await post("/api/duels/" + duelId + "/submissions", { language, sourceCode: source }, keys.current.submit);
        onSubmitted();
      }
      keys.current[kind] = uuid();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not send your code");
    } finally { setBusy(null); }
  }, [busy, source, language, round.problem_version_id, duelId, toast, onSubmitted]);

  const submitBlocked = waiting ? "Judging your last submission…" : solved ? "Solved: waiting for the round to be decided" : locked ? `Penalty: ${Math.ceil((lockedUntil - now) / 1000)} s` : null;
  const runResult = run?.detail?.judging[0];

  return (
    <div className={"workspace duel-workspace" + (player ? "" : " spectating")}>
      <section className="ws-left">
        <div className="ws-scroll">
          <div className="ws-meta"><span className="badge info">Round {round.number}</span>{round.difficulty && <DifficultyPill value={round.difficulty} />}</div>
          {problem.data ? <ProblemStatement problem={problem.data} /> : problem.error ? <ErrorBox error={problem.error} /> : <Loading />}
        </div>
      </section>
      <div className="ws-divider" />
      <section className="ws-right">
        {player && (
          <>
            <div className="ws-bar">
              <select value={language} onChange={(e) => { setLanguage(e.target.value); try { localStorage.setItem("cp.language", e.target.value); } catch { /* ignore */ } }} style={{ width: "auto" }}>
                {languages.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l] ?? l}</option>)}
              </select>
              <span className="spacer" />
              {submitBlocked && <span className={"small " + (locked ? "duel-locked" : "muted")}>{submitBlocked}</span>}
              <button onClick={() => send("run")} disabled={Boolean(busy) || !source.trim() || !problem.data?.samples.length}>{busy === "run" ? "Sending…" : "▶ Run examples"}</button>
              <button className="primary" onClick={() => send("submit")} disabled={Boolean(busy) || !source.trim() || Boolean(submitBlocked)}>{busy === "submit" ? "Sending…" : "Submit ⚔"}</button>
            </div>
            <div className="ws-editor"><CodeEditor value={source} onChange={setSource} language={language} onSubmit={() => send("submit")} onRun={() => send("run")} /></div>
            {run && (
              <div className="ws-console">
                {!runResult?.verdict && runResult?.status !== "FAILED" ? <div className="row"><span className="spinner" /><strong>Running on the examples…</strong></div> : (
                  <div className="stack" style={{ gap: "0.5rem" }}>
                    <div className="row"><span className={"verdict-big " + (VERDICTS[runResult!.verdict ?? ""]?.tone ?? "neutral")}>{runResult!.verdict ? VERDICTS[runResult!.verdict]?.label : "Judge error"}</span>
                      <span className="small muted">Examples only, does not count</span><span className="spacer" /><button className="ghost small" onClick={() => setRun(null)}>✕</button></div>
                    {run.detail?.cases && <TestCases cases={run.detail.cases} compileError={runResult!.verdict === "COMPILATION_ERROR"} />}
                    {runResult!.public_feedback && <pre className="compiler-output">{runResult!.public_feedback}</pre>}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <div className="duel-feed">
          <strong className="small">Live feed · round {round.number}</strong>
          {roundFeed.length === 0 ? <div className="small muted">No submission yet. Be first.</div> : roundFeed.map((f, i) => (
            <div key={i} className={"duel-event" + (f.mine ? " mine" : "")} onClick={() => f.id && setOpen(f.id)} style={{ cursor: f.id ? "pointer" : "default" }}>
              <strong>{f.mine ? "You" : "@" + f.handle}</strong>
              <span className="small muted">{LANGUAGE_NAMES[f.language_code] ?? f.language_code}</span>
              <span className="spacer" />
              {f.total_tests ? <span className="small mono">{f.passed_tests}/{f.total_tests}</span> : null}
              <Verdict status={f.status} verdict={f.verdict} />
            </div>
          ))}
        </div>
      </section>
      {open && <SubmissionModal id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FinishedDuel({ state }: { state: DuelState }) {
  const { duel: d, role, rounds } = state;
  const { me } = useAuth();
  const { run, busy } = useAction();
  const won = d.winner_handle === me?.handle;
  const title = !d.winner_handle ? "Draw" : role === "SPECTATOR" ? `@${d.winner_handle} wins` : won ? "Victory 🏆" : "Defeat";
  const rematch = async () => {
    const r = await run(() => post<{ duelId: string }>("/api/duels", { bestOf: bestOf(d), roundMinutes: d.round_seconds / 60, lockoutSeconds: d.lockout_seconds, difficulty: d.difficulty }));
    if (r) navigate("/duel/" + r.duelId);
  };
  return (
    <div className="stack">
      <div className={"card duel-final " + (!d.winner_handle ? "draw" : won || role === "SPECTATOR" ? "win" : "loss")}>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <span className="muted">{d.end_reason === "FORFEIT" ? "Ended by forfeit." : d.end_reason === "DRAW" ? "Out of rounds with an even score." : `First to ${d.rounds_to_win} round${d.rounds_to_win > 1 ? "s" : ""}.`}</span>
        <div className="row">
          {role !== "SPECTATOR" && <button className="primary" disabled={busy} onClick={rematch}>New challenge, same settings</button>}
          <a className="btn" href="#/duels">Back to duels</a>
        </div>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Round</th><th>Problem</th><th>Winner</th><th>How</th><th className="right">Submissions</th></tr></thead>
          <tbody>
            {rounds.filter((r) => r.result).map((r) => (
              <tr key={r.number} onClick={() => r.problem_version_id && navigate("/practice/" + r.problem_version_id)} style={{ cursor: "pointer" }} title="Open in practice">
                <td>{r.number}</td>
                <td><strong>{r.title}</strong> {r.difficulty && <DifficultyPill value={r.difficulty} />}</td>
                <td>{r.winner_handle ? "@" + r.winner_handle : "—"}</td>
                <td className="small muted">{RESULT_TEXT[r.result!]}</td>
                <td className="right mono">{state.feed.filter((f) => f.duel_round === r.number).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
