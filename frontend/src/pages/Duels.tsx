import { useCallback, useEffect, useRef, useState } from "react";
import { get, post, serverNow } from "../api";
import { navigate, useAction, useAuth, useData, useServerClock, useToast } from "../app";
import { ProblemStatement, SubmissionModal, TestCases, draftKey, readDraft, templateFor, uuid,
  type ProblemDetail, type SubmissionDetail } from "../components/Problem";
import { CodeEditor, Empty, ErrorBox, LANGUAGE_NAMES, Loading, VERDICTS, Verdict, ago } from "../ui";
import { parseSignature } from "../lib/functionMode";
import { DifficultyPill } from "./Practice";
import { Avatar } from "../components/Avatar";

type Mode = "DUEL" | "TEAMS" | "FFA";
type Player = { handle: string; display_name: string; team: number | null; left_room: boolean; points: number; wins: number };
type Room = {
  id: string; status: "WAITING" | "ACTIVE" | "FINISHED" | "CANCELLED"; mode: Mode; max_players: number;
  rounds_to_win: number; rounds_total: number | null; round_seconds: number; lockout_seconds: number; difficulty: string | null;
  modifiers: string[]; created_at: string; started_at: string | null; finished_at: string | null;
  end_reason: "ROUNDS" | "FORFEIT" | "DRAW" | "EXPIRED" | null; winner_team: number | null;
  host_handle: string; winner_handle: string | null; players: Player[];
};
type Round = {
  number: number; starts_at: string | null; ends_at: string | null; result: string | null; winner_handle: string | null; winner_team: number | null;
  modifier: string | null; forced_language: string | null; problem_version_id: string | null; title: string | null; difficulty: string | null;
  places: { handle: string; place: number; points: number }[];
};
type FeedItem = {
  id?: string; duel_round: number; handle: string; team: number | null; submitted_at: string; language_code: string; mine: boolean; length: number;
  status: string | null; verdict: string | null; passed_tests: number | null; total_tests: number | null; execution_time_ms: number | null;
};
type RoomState = { serverTime: number; duel: Room; role: "PLAYER" | "SPECTATOR"; host: boolean; myTeam: number | null; rounds: Round[]; feed: FeedItem[]; lockedSeconds?: number };
type Lists = { mine: Room[]; open: Room[]; live: Room[] };

/** Every twist the wheel can land on: what it does to a round. */
export const TWISTS: Record<string, { icon: string; name: string; rule: string }> = {
  CLASSIC: { icon: "⚡", name: "Classic", rule: "First accepted answer wins." },
  BLIND: { icon: "🙈", name: "Blind", rule: "No examples in the statement, and no example runs." },
  NO_FOR: { icon: "🚫", name: "No for", rule: "The word \"for\" is banned, comments included. Use while, recursion or library calls." },
  NO_PLUS: { icon: "➖", name: "No plus", rule: "The + character is banned everywhere, even in #include <bits/stdc++.h>." },
  GOLF: { icon: "⛳", name: "Code golf", rule: "Shortest accepted code wins. Keep improving until the clock ends." },
  FASTEST: { icon: "🏎", name: "Fastest", rule: "Quickest accepted run wins. Keep improving until the clock ends." },
  LANGUAGE: { icon: "🧠", name: "Forced language", rule: "Everyone must use the language the wheel picked." },
};
const IMPROVING = new Set(["GOLF", "FASTEST"]);
const RESULT_TEXT: Record<string, string> = {
  ACCEPTED: "first accepted", TESTS: "most tests passed", SHORTEST: "shortest code", FASTEST: "fastest run",
  POINTS: "placement points", FORFEIT: "forfeit", DRAW: "draw",
};
const MODE_NAME = (r: Pick<Room, "mode" | "max_players">) => r.mode === "DUEL" ? "1v1" : r.mode === "TEAMS" ? `${r.max_players / 2}v${r.max_players / 2}` : `Free-for-all (${r.max_players})`;
const roundsText = (r: Room) => r.mode === "FFA" ? `${r.rounds_total} rounds` : `best of ${r.rounds_to_win * 2 - 1}`;
const settings = (r: Room) => `${MODE_NAME(r)} · ${roundsText(r)} · ${r.round_seconds / 60} min rounds${r.difficulty ? " · " + r.difficulty.toLowerCase() : ""}`;
const pendingVerdict = (s: { status: string | null; verdict: string | null }) => !s.verdict && s.status !== "FAILED";
const teamOf = (r: Room, n: number) => r.players.filter((p) => p.team === n);
const twistLabel = (m: string | null, language?: string | null) => {
  const t = TWISTS[m ?? "CLASSIC"];
  return t ? `${t.icon} ${t.name}${m === "LANGUAGE" && language ? ": " + (LANGUAGE_NAMES[language] ?? language) : ""}` : m ?? "";
};
/** Whether this room counts as a win, loss or draw for a handle. */
function outcome(r: Room, handle?: string) {
  if (r.mode === "TEAMS") {
    const mine = r.players.find((p) => p.handle === handle)?.team;
    return !r.winner_team ? "draw" : r.winner_team === mine ? "win" : "loss";
  }
  return !r.winner_handle ? "draw" : r.winner_handle === handle ? "win" : "loss";
}

function TwistChips({ modifiers }: { modifiers: string[] }) {
  const list = modifiers.length ? modifiers : ["CLASSIC"];
  return <span className="twist-chips">{list.map((m) => <span key={m} className="twist-chip" title={TWISTS[m]?.rule}>{TWISTS[m]?.icon} {TWISTS[m]?.name}</span>)}</span>;
}

// ---------- Hub: create a room, join one, watch live ones ----------
export function DuelHub() {
  const lists = useData<Lists>("/api/duels", 4000);
  const { me } = useAuth();
  const { busy, run } = useAction();
  const [form, setForm] = useState({ mode: "DUEL" as Mode, bestOf: 3, teamSize: 2, maxPlayers: 6, rounds: 3, roundMinutes: 5, lockoutSeconds: 15, difficulty: "", modifiers: [] as string[] });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const create = async () => {
    const r = await run(() => post<{ duelId: string }>("/api/duels", { ...form, difficulty: form.difficulty || null }));
    if (r) navigate("/duel/" + r.duelId);
  };
  const join = async (id: string) => {
    if (await run(() => post("/api/duels/" + id + "/join"))) navigate("/duel/" + id);
  };
  const mine = lists.data?.mine ?? [];
  const current = mine.find((d) => (d.status === "ACTIVE" || d.status === "WAITING") && d.players.some((p) => p.handle === me?.handle && !p.left_room));
  const history = mine.filter((d) => d.status === "FINISHED");
  const toggleTwist = (m: string) => set({ modifiers: form.modifiers.includes(m) ? form.modifiers.filter((x) => x !== m) : [...form.modifiers, m] });

  return (
    <main className="page page-wide">
      <section className="practice-hero duel-hero">
        <div className="stack" style={{ gap: "0.4rem", flex: "1 1 320px" }}>
          <div className="eyebrow">⚔ Blitz rooms</div>
          <h1 style={{ margin: 0 }}>Duel, team up, or fight ten at once</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 560 }}>Short rounds, one problem each. In a <strong>1v1</strong> or <strong>team</strong> room, the first accepted answer wins the round.
            In a <strong>free-for-all</strong>, every round ranks everyone and pays placement points. Add twists and a wheel picks one for each round.
            You see the others' verdicts live, never their code.</p>
        </div>
        <div className="card duel-create">
          <strong>New room</strong>
          <div className="filters">
            {(["DUEL", "TEAMS", "FFA"] as Mode[]).map((m) => <button key={m} className={form.mode === m ? "active" : ""} onClick={() => set({ mode: m })}>{m === "DUEL" ? "1v1" : m === "TEAMS" ? "Teams" : "Free-for-all"}</button>)}
          </div>
          <div className="row">
            {form.mode === "TEAMS" && <label className="small">Teams <select value={form.teamSize} onChange={(e) => set({ teamSize: Number(e.target.value) })} style={{ width: "auto" }}>
              <option value={2}>2v2</option><option value={3}>3v3</option></select></label>}
            {form.mode === "FFA" ? <>
              <label className="small">Players <select value={form.maxPlayers} onChange={(e) => set({ maxPlayers: Number(e.target.value) })} style={{ width: "auto" }}>
                {[3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>up to {n}</option>)}</select></label>
              <label className="small">Rounds <select value={form.rounds} onChange={(e) => set({ rounds: Number(e.target.value) })} style={{ width: "auto" }}>
                {[1, 2, 3, 4, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </> : <label className="small">Best of <select value={form.bestOf} onChange={(e) => set({ bestOf: Number(e.target.value) })} style={{ width: "auto" }}>
              {[1, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
            <label className="small">Round <select value={form.roundMinutes} onChange={(e) => set({ roundMinutes: Number(e.target.value) })} style={{ width: "auto" }}>
              {[2, 3, 5, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
            <label className="small">Penalty <select value={form.lockoutSeconds} onChange={(e) => set({ lockoutSeconds: Number(e.target.value) })} style={{ width: "auto" }}>
              {[0, 10, 15, 30, 60].map((s) => <option key={s} value={s}>{s ? s + " s" : "none"}</option>)}</select></label>
            <label className="small">Level <select value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value })} style={{ width: "auto" }}>
              <option value="">Mixed</option><option value="EASY">Easy</option><option value="MEDIUM">Medium</option><option value="HARD">Hard</option></select></label>
          </div>
          <div className="stack" style={{ gap: "0.3rem" }}>
            <span className="small muted">Twists: the wheel picks one per round from those you select (none: always classic).</span>
            <div className="twist-picker">
              {Object.entries(TWISTS).map(([key, t]) => (
                <button key={key} className={"twist-chip" + (form.modifiers.includes(key) ? " on" : "")} title={t.rule} onClick={() => toggleTwist(key)}>{t.icon} {t.name}</button>
              ))}
            </div>
          </div>
          <button className="primary" disabled={busy || Boolean(current)} onClick={create} title={current ? "Finish or leave your current room first" : ""}>Create room</button>
        </div>
      </section>

      <ErrorBox error={lists.error} />
      {current && (
        <div className="notice ok row-between">
          <span>{current.status === "WAITING" ? `You are in a ${MODE_NAME(current)} room waiting to start.` : `Your ${MODE_NAME(current)} room is running.`}</span>
          <a className="btn primary small" href={"#/duel/" + current.id}>{current.status === "WAITING" ? "Open" : "Back to the room"}</a>
        </div>
      )}
      {lists.loading ? <Loading /> : (
        <div className="duel-columns">
          <section className="stack">
            <h3 style={{ margin: 0 }}>Open rooms</h3>
            {(lists.data?.open ?? []).length === 0 ? <Empty>No open room right now. Create one and share its link.</Empty> :
              lists.data!.open.map((d) => (
                <div key={d.id} className="card duel-row">
                  <Avatar handle={d.host_handle} size={34} />
                  <div className="stack" style={{ gap: "0.15rem", flex: 1 }}>
                    <strong>{MODE_NAME(d)} · @{d.host_handle} <span className="small muted">{d.players.length}/{d.max_players} players</span></strong>
                    <span className="small muted">{roundsText(d)} · {d.round_seconds / 60} min · {ago(d.created_at)}</span>
                    <TwistChips modifiers={d.modifiers} />
                  </div>
                  <button className="primary small" disabled={busy || Boolean(current)} onClick={() => join(d.id)}>Join ⚔</button>
                </div>
              ))}
            <h3 style={{ margin: "1rem 0 0" }}>Live now</h3>
            {(lists.data?.live ?? []).length === 0 ? <Empty>No room is being played.</Empty> :
              lists.data!.live.map((d) => (
                <a key={d.id} className="card duel-row" href={"#/duel/" + d.id}>
                  <span className="live-dot" aria-hidden />
                  <strong style={{ flex: 1 }}>{MODE_NAME(d)}: {d.mode === "TEAMS"
                    ? `${teamOf(d, 1).map((p) => "@" + p.handle).join(" ")} vs ${teamOf(d, 2).map((p) => "@" + p.handle).join(" ")}`
                    : d.players.map((p) => "@" + p.handle).join(" · ")}</strong>
                  <span className="small muted">Watch ›</span>
                </a>
              ))}
          </section>
          <section className="stack">
            <h3 style={{ margin: 0 }}>Your rooms</h3>
            {history.length === 0 ? <Empty>Your finished rooms appear here.</Empty> : (
              <div className="card table-wrap" style={{ padding: 0 }}>
                <table><tbody>
                  {history.map((d) => {
                    const o = outcome(d, me?.handle);
                    const myPoints = d.players.find((p) => p.handle === me?.handle)?.points ?? 0;
                    return (
                      <tr key={d.id} onClick={() => navigate("/duel/" + d.id)} style={{ cursor: "pointer" }}>
                        <td><span className={"duel-outcome " + o}>{o === "win" ? "Won" : o === "loss" ? "Lost" : "Draw"}</span></td>
                        <td>{MODE_NAME(d)} <span className="small muted">with {d.players.filter((p) => p.handle !== me?.handle).map((p) => "@" + p.handle).join(", ")}</span>
                          {d.end_reason === "FORFEIT" && <span className="small muted"> (forfeit)</span>}</td>
                        <td className="mono">{d.mode === "FFA" ? myPoints + " pts" : ""}</td>
                        <td className="small muted right">{ago(d.finished_at)}</td>
                      </tr>
                    );
                  })}
                </tbody></table>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

// ---------- Room: lobby, rounds and results, for players and spectators ----------
export function DuelRoom({ id }: { id: string }) {
  const state = useData<RoomState>("/api/duels/" + id, 1000);
  const { me } = useAuth();
  const toast = useToast();
  const now = useServerClock();
  const { busy, run } = useAction();
  // Announce the others' verdicts as they land; in a big free-for-all only the accepted ones.
  const seen = useRef<Set<string> | null>(null);
  const feed = state.data?.feed;
  useEffect(() => {
    if (!feed || !state.data || state.data.role === "SPECTATOR") return;
    const { mode } = state.data.duel, myTeam = state.data.myTeam;
    const key = (f: FeedItem) => f.submitted_at + f.handle;
    if (seen.current) {
      for (const f of feed) if (!f.mine && f.verdict && !seen.current.has(key(f)) && (mode !== "FFA" || f.verdict === "ACCEPTED")) {
        const mate = mode === "TEAMS" && f.team === myTeam;
        toast(mate || f.verdict !== "ACCEPTED" ? "info" : "error",
          `${mate ? "🤝" : "⚔"} @${f.handle}: ${VERDICTS[f.verdict]?.label ?? f.verdict}${f.total_tests ? ` (${f.passed_tests}/${f.total_tests})` : ""}`);
      }
    }
    seen.current = new Set(feed.filter((f) => !f.mine && f.verdict).map(key));
  }, [feed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.loading) return <Loading label="Entering the room…" />;
  if (!state.data) return <main className="page"><ErrorBox error={state.error} /><a href="#/duels">← Duels</a></main>;
  const { duel: d, role, rounds } = state.data;
  const player = role === "PLAYER";
  const leave = async () => {
    const text = d.status === "WAITING" ? (state.data!.host ? "Close this room?" : "Leave this room?")
      : d.mode === "FFA" ? "Leave the room? You stop scoring and cannot win." : "Forfeit? If nobody is left on your side, the others win.";
    if (confirm(text) && await run(() => post("/api/duels/" + id + "/leave"))) state.reload();
  };

  if (d.status === "WAITING" || d.status === "CANCELLED") return <Lobby state={state.data} onLeave={leave} onChange={state.reload} busy={busy} />;

  const current = rounds.find((r) => !r.result && r.starts_at);
  const counting = current?.starts_at && Date.parse(current.starts_at) > now;
  const lastDecided = [...rounds].reverse().find((r) => r.result);
  const header = (
    <div className="duel-board-wrap">
      <Scoreboard room={d} rounds={rounds} me={me?.handle} />
      <div className="duel-center">
        {d.status === "ACTIVE" && current?.ends_at && !counting && (
          <div className={"duel-clock mono" + (Date.parse(current.ends_at) - now < 30000 ? " hurry" : "")}>{mmss(Date.parse(current.ends_at) - now)}</div>
        )}
        {d.status === "ACTIVE" && counting && <div className="duel-clock mono">Round {current!.number}</div>}
        {d.status === "FINISHED" && <div className="duel-clock">Final</div>}
        {current?.modifier && <span className="twist-chip on" title={TWISTS[current.modifier]?.rule}>{twistLabel(current.modifier, current.forced_language)}</span>}
        <div className="small muted">{settings(d)}</div>
      </div>
    </div>
  );

  if (d.status === "FINISHED") return <main className="page page-wide">{header}<Finished state={state.data} /></main>;

  return (
    <div className="duel-room">
      <div className="duel-top">
        <a href="#/duels" className="small">← Duels</a>
        {header}
        {player ? <button className="ghost small" disabled={busy} onClick={leave}>{d.mode === "FFA" ? "Leave" : "Forfeit"}</button> : <span className="badge info">Spectating</span>}
      </div>
      {!current ? <Loading label="Deciding the round…" /> : counting ? (
        <div className="duel-countdown">
          {lastDecided && <LastRound round={lastDecided} room={d} />}
          <div className="eyebrow">Round {current.number} · the wheel says</div>
          <div className="twist-reveal">
            <span className="twist-icon">{TWISTS[current.modifier ?? "CLASSIC"]?.icon}</span>
            <strong>{twistLabel(current.modifier, current.forced_language).replace(/^\S+ /, "")}</strong>
            <span className="muted">{TWISTS[current.modifier ?? "CLASSIC"]?.rule}</span>
          </div>
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

function LastRound({ round: r, room }: { round: Round; room: Room }) {
  if (r.result === "DRAW") return <div className="duel-last">Round {r.number}: draw, nobody passed a test</div>;
  if (room.mode === "FFA") return (
    <div className="duel-last">Round {r.number}: {r.places.filter((p) => p.points > 0).slice(0, 3).map((p) => `${["🥇", "🥈", "🥉"][p.place - 1] ?? p.place + "."} @${p.handle} +${p.points}`).join("   ")}</div>
  );
  const who = room.mode === "TEAMS" ? `Team ${r.winner_team} (@${r.winner_handle})` : "@" + r.winner_handle;
  return <div className="duel-last">Round {r.number}: <strong>{who}</strong> wins ({RESULT_TEXT[r.result ?? ""] ?? r.result})</div>;
}

/** 1v1: two players. Teams: two columns. Free-for-all: everyone by points. */
function Scoreboard({ room: d, rounds, me }: { room: Room; rounds: Round[]; me?: string }) {
  const current = rounds.find((r) => !r.result && r.starts_at);
  const dots = (
    <div className="duel-rounds">
      {rounds.map((r) => {
        const side = d.mode === "TEAMS" ? (r.winner_team === 1 ? " left" : r.winner_team === 2 ? " right" : "")
          : d.mode === "DUEL" ? (r.winner_handle === d.players[0]?.handle ? " left" : r.winner_handle ? " right" : "") : r.winner_handle ? " left" : "";
        return <span key={r.number} title={`Round ${r.number}: ${twistLabel(r.modifier, r.forced_language)}${r.result ? " · " + (r.winner_handle ? "@" + r.winner_handle : "draw") : ""}`}
          className={"duel-dot" + (r.result ? (side || " draw") : r === current ? " now" : "")} />;
      })}
    </div>
  );
  if (d.mode === "FFA") {
    const ranked = [...d.players].sort((a, b) => b.points - a.points || b.wins - a.wins);
    return (
      <div className="duel-ffa">
        {dots}
        <div className="ffa-board">
          {ranked.map((p, i) => (
            <span key={p.handle} className={"ffa-player" + (p.handle === me ? " me" : "") + (p.left_room ? " left-room" : "")}>
              <span className="muted small">{i + 1}.</span> <Avatar handle={p.handle} size={20} /> @{p.handle} <strong className="mono">{p.points}</strong>
            </span>
          ))}
        </div>
      </div>
    );
  }
  const wins = (side: 1 | 2) => d.mode === "TEAMS" ? rounds.filter((r) => r.winner_team === side).length
    : rounds.filter((r) => r.winner_handle && r.winner_handle === d.players[side - 1]?.handle).length;
  const side = (n: 1 | 2) => {
    const members = d.mode === "TEAMS" ? teamOf(d, n) : d.players[n - 1] ? [d.players[n - 1]] : [];
    return (
      <div className={"duel-player" + (n === 2 ? " right" : "")}>
        <div className="duel-members">{members.map((p) => <span key={p.handle} className={p.left_room ? "left-room" : ""}><Avatar handle={p.handle} size={26} /> @{p.handle}{p.handle === me ? <span className="small muted"> (you)</span> : null}</span>)}</div>
        <span className="duel-pips">{Array.from({ length: d.rounds_to_win }, (_, i) => <span key={i} className={i < wins(n) ? "on" : ""} />)}</span>
        <span className="duel-score mono">{wins(n)}</span>
      </div>
    );
  };
  return <div className="duel-board">{side(1)}{dots}{side(2)}</div>;
}

function Lobby({ state, onLeave, onChange, busy }: { state: RoomState; onLeave: () => void; onChange: () => void; busy: boolean }) {
  const { duel: d, role, host, myTeam } = state;
  const { run, busy: acting } = useAction();
  const link = window.location.origin + window.location.pathname + "#/duel/" + d.id;
  if (d.status === "CANCELLED") return <main className="page"><Empty>This room was {d.end_reason === "EXPIRED" ? "not started within an hour" : "closed"}. <a href="#/duels">Back to duels</a></Empty></main>;
  const member = role === "PLAYER";
  const act = async (path: string, body?: unknown) => { if (await run(() => post("/api/duels/" + d.id + path, body ?? {}))) onChange(); };
  const canStart = d.mode === "TEAMS" ? teamOf(d, 1).length > 0 && teamOf(d, 2).length > 0 : d.players.length >= 2;
  const seat = (p: Player) => <div key={p.handle} className="lobby-seat"><Avatar handle={p.handle} size={30} /> <strong>@{p.handle}</strong>{p.handle === d.host_handle && <span className="badge info">host</span>}</div>;
  const empty = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => <div key={"e" + i} className="lobby-seat empty">waiting…</div>);
  return (
    <main className="page">
      <div className="card duel-waiting">
        <div className="eyebrow">⚔ {MODE_NAME(d)} room</div>
        <h1 style={{ margin: 0 }}>@{d.host_handle}'s room</h1>
        <p className="muted" style={{ margin: 0 }}>{settings(d)} · {d.lockout_seconds ? `${d.lockout_seconds} s penalty after a wrong answer` : "no wrong-answer penalty"}</p>
        <TwistChips modifiers={d.modifiers} />
        {d.mode === "TEAMS" ? (
          <div className="lobby-teams">
            {[1, 2].map((n) => (
              <div key={n} className={"lobby-team team-" + n}>
                <strong>Team {n}</strong>
                {teamOf(d, n).map(seat)}{empty(d.max_players / 2 - teamOf(d, n).length)}
                {member && myTeam !== n && teamOf(d, n).length < d.max_players / 2 && <button className="small" disabled={acting} onClick={() => act("/team", { team: n })}>Switch to team {n}</button>}
                {!member && teamOf(d, n).length < d.max_players / 2 && <button className="primary small" disabled={acting} onClick={() => act("/join", { team: n })}>Join team {n}</button>}
              </div>
            ))}
          </div>
        ) : (
          <div className="lobby-seats">{d.players.map(seat)}{empty(d.max_players - d.players.length)}</div>
        )}
        <p className="small muted" style={{ margin: 0 }}>{d.players.length}/{d.max_players} players. A full room starts by itself{d.mode !== "DUEL" ? "; the host can also start earlier" : ""}.</p>
        {member && (
          <div className="row">
            <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
            <button onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
          </div>
        )}
        <div className="row">
          {host && d.mode !== "DUEL" && <button className="primary" disabled={acting || !canStart} onClick={() => act("/start")} title={canStart ? "" : d.mode === "TEAMS" ? "Each team needs a player" : "Wait for an opponent"}>Start now</button>}
          {!member && d.mode !== "TEAMS" && <button className="primary" disabled={acting} onClick={() => act("/join")}>Join the room ⚔</button>}
          {member && <button className="ghost small" disabled={busy} onClick={onLeave}>{host ? "Close room" : "Leave room"}</button>}
          {member && <span className="row small muted"><span className="spinner" /> Waiting for players…</span>}
        </div>
      </div>
    </main>
  );
}

/** Client-side copy of the twist rules, so a banned submission is caught before it is sent. */
function twistProblem(twist: string | null, source: string) {
  if (twist === "NO_FOR" && /\bfor\b/.test(source)) return "Your code contains the banned word \"for\"";
  if (twist === "NO_PLUS" && source.includes("+")) return "Your code contains the banned + character";
  return null;
}
const codeLength = (source: string) => new TextEncoder().encode(source.trim()).length;

/** Statement, editor and live feed for the round being played. */
function RoundWorkspace({ duelId, round, state, player, onSubmitted }: { duelId: string; round: Round; state: RoomState; player: boolean; onSubmitted: () => void }) {
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
  const twist = round.modifier ?? "CLASSIC";

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

  // "Run examples" is judged on the statement's examples only and never counts in the room.
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
  const banned = twistProblem(twist, source);

  const send = useCallback(async (kind: "run" | "submit") => {
    if (busy || !source.trim()) return;
    const problemText = twistProblem(twist, source);
    if (problemText) { toast("error", problemText); return; }
    setBusy(kind);
    try {
      const body = kind === "run" ? { language, sourceCode: source, mode: "samples" } : { language, sourceCode: source };
      const r = await post<{ submissionId: string }>("/api/duels/" + duelId + "/submissions", body, keys.current[kind]);
      if (kind === "run") setRun({ id: r.submissionId }); else onSubmitted();
      keys.current[kind] = uuid();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not send your code");
    } finally { setBusy(null); }
  }, [busy, source, language, twist, duelId, toast, onSubmitted]);

  const submitBlocked = waiting ? "Judging your last submission…" : solved && !IMPROVING.has(twist) ? "Solved: waiting for the round to be decided"
    : locked ? `Penalty: ${Math.ceil((lockedUntil - now) / 1000)} s` : null;
  const runResult = run?.detail?.judging[0];
  const best = myFeed.filter((f) => f.verdict === "ACCEPTED");

  return (
    <div className={"workspace duel-workspace" + (player ? "" : " spectating")}>
      <section className="ws-left">
        <div className="ws-scroll">
          <div className="ws-meta"><span className="badge info">Round {round.number}</span>{round.difficulty && <DifficultyPill value={round.difficulty} />}</div>
          <div className="notice small twist-banner"><strong>{twistLabel(twist, round.forced_language)}</strong> {TWISTS[twist]?.rule}</div>
          {problem.data ? <ProblemStatement problem={problem.data} /> : problem.error ? <ErrorBox error={problem.error} /> : <Loading />}
        </div>
      </section>
      <div className="ws-divider" />
      <section className="ws-right">
        {player && (
          <>
            <div className="ws-bar">
              <select value={language} disabled={twist === "LANGUAGE"} onChange={(e) => { setLanguage(e.target.value); try { localStorage.setItem("cp.language", e.target.value); } catch { /* ignore */ } }} style={{ width: "auto" }}>
                {languages.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l] ?? l}</option>)}
              </select>
              {twist === "GOLF" && <span className="small mono" title="Bytes counted for golf (surrounding whitespace ignored)">{codeLength(source)} bytes{best.length ? ` · best ${Math.min(...best.map((f) => f.length))}` : ""}</span>}
              {twist === "FASTEST" && best.length > 0 && <span className="small mono">best {Math.min(...best.map((f) => f.execution_time_ms ?? 0))} ms</span>}
              <span className="spacer" />
              {(banned || submitBlocked) && <span className={"small " + (banned || locked ? "duel-locked" : "muted")}>{banned ?? submitBlocked}</span>}
              <button onClick={() => send("run")} disabled={Boolean(busy) || !source.trim() || twist === "BLIND" || !problem.data?.samples.length} title={twist === "BLIND" ? "Blind round: no examples" : ""}>{busy === "run" ? "Sending…" : "▶ Run examples"}</button>
              <button className="primary" onClick={() => send("submit")} disabled={Boolean(busy) || !source.trim() || Boolean(submitBlocked) || Boolean(banned)}>{busy === "submit" ? "Sending…" : solved && IMPROVING.has(twist) ? "Improve ⚔" : "Submit ⚔"}</button>
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
            <div key={i} className={"duel-event" + (f.mine ? " mine" : f.team === state.myTeam && state.duel.mode === "TEAMS" ? " mate" : "")} onClick={() => f.id && setOpen(f.id)} style={{ cursor: f.id ? "pointer" : "default" }}>
              <strong>{f.mine ? "You" : "@" + f.handle}</strong>
              {state.duel.mode === "TEAMS" && <span className="small muted">team {f.team}</span>}
              <span className="small muted">{LANGUAGE_NAMES[f.language_code] ?? f.language_code}</span>
              <span className="spacer" />
              {twist === "GOLF" && <span className="small mono">{f.length} B</span>}
              {twist === "FASTEST" && f.verdict === "ACCEPTED" && <span className="small mono">{f.execution_time_ms} ms</span>}
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

function Finished({ state }: { state: RoomState }) {
  const { duel: d, role, rounds } = state;
  const { me } = useAuth();
  const { run, busy } = useAction();
  const o = outcome(d, me?.handle);
  const title = d.mode === "TEAMS"
    ? (!d.winner_team ? "Draw" : role === "SPECTATOR" || !state.myTeam ? `Team ${d.winner_team} wins` : o === "win" ? "Victory 🏆" : "Defeat")
    : (!d.winner_handle ? "Draw" : role === "SPECTATOR" ? `@${d.winner_handle} wins` : o === "win" ? "Victory 🏆" : `@${d.winner_handle} wins`);
  const again = async () => {
    const body = { mode: d.mode, bestOf: d.rounds_to_win * 2 - 1, teamSize: d.max_players / 2, maxPlayers: d.max_players, rounds: d.rounds_total ?? 3,
      roundMinutes: d.round_seconds / 60, lockoutSeconds: d.lockout_seconds, difficulty: d.difficulty, modifiers: d.modifiers };
    const r = await run(() => post<{ duelId: string }>("/api/duels", body));
    if (r) navigate("/duel/" + r.duelId);
  };
  const standings = [...d.players].sort((a, b) => b.points - a.points || b.wins - a.wins);
  return (
    <div className="stack">
      <div className={"card duel-final " + (o === "draw" ? "draw" : o === "win" || role === "SPECTATOR" ? "win" : "loss")}>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <span className="muted">{d.end_reason === "FORFEIT" ? "Ended by forfeit." : d.end_reason === "DRAW" ? "Out of rounds with an even score." : d.mode === "FFA" ? "Most placement points after every round." : `First to ${d.rounds_to_win} round${d.rounds_to_win > 1 ? "s" : ""}.`}</span>
        <div className="row">
          <button className="primary" disabled={busy} onClick={again}>New room, same settings</button>
          <a className="btn" href="#/duels">Back to duels</a>
        </div>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>#</th><th>Player</th>{d.mode === "TEAMS" && <th>Team</th>}<th className="right">{d.mode === "FFA" ? "Points" : "Rounds won"}</th><th className="right">Round wins</th></tr></thead>
          <tbody>{standings.map((p, i) => (
            <tr key={p.handle} className={p.handle === me?.handle ? "row-solved" : ""}>
              <td>{i + 1}</td><td><strong>@{p.handle}</strong>{p.left_room && <span className="small muted"> (left)</span>}</td>
              {d.mode === "TEAMS" && <td>Team {p.team}</td>}
              <td className="right mono">{p.points}</td><td className="right mono">{p.wins}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Round</th><th>Twist</th><th>Problem</th><th>Winner</th><th>How</th><th className="right">Submissions</th></tr></thead>
          <tbody>
            {rounds.filter((r) => r.result).map((r) => (
              <tr key={r.number}>
                <td>{r.number}</td>
                <td className="small">{twistLabel(r.modifier, r.forced_language)}</td>
                <td><strong>{r.title}</strong> {r.difficulty && <DifficultyPill value={r.difficulty} />}</td>
                <td>{r.winner_handle ? (d.mode === "TEAMS" ? `Team ${r.winner_team} (@${r.winner_handle})` : "@" + r.winner_handle) : "—"}</td>
                <td className="small muted">{RESULT_TEXT[r.result!] ?? r.result}</td>
                <td className="right mono">{state.feed.filter((f) => f.duel_round === r.number).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
