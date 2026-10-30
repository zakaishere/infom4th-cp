import { useEffect, useRef, useState } from "react";
import { useData } from "../app";
import { Badge, Empty, ErrorBox, Loading } from "../ui";

export type Cell = { slot: number; solved: boolean; attempts: number; solveSeconds: number; frozen: boolean; score: number };
export type Row = { rank: number; entry: string; solved: number; score: number; penaltySeconds: number | null; problems: Cell[] };
export type Board = {
  scoring: "ICPC" | "IOI" | "CODEFORCES" | "ATCODER";
  standings: Row[];
  entries: { id: string; display_name: string; members: string | null }[];
  problems: { slot: number; label: string; points: number }[];
  problemStats: { slot: number; solved: number; tried: number }[];
  frozen: boolean;
};

export const SCORING_INFO: Record<Board["scoring"], { name: string; summary: string; rank: string }> = {
  ICPC: { name: "ICPC", summary: "Most problems solved wins; ties are broken by total time, where each rejected attempt before acceptance adds a penalty.",
    rank: "Ranked by problems solved, then by penalty time (lower is better)." },
  IOI: { name: "IOI", summary: "Each problem gives points for every test passed. Your best submission per problem counts. No time penalty.",
    rank: "Ranked by total points. Partial solutions score partial points." },
  CODEFORCES: { name: "Codeforces", summary: "Each problem is worth points that decrease over time; every rejected attempt before acceptance costs 50 points. You always keep at least 30%.",
    rank: "Ranked by total points. Solve early and avoid rejected attempts." },
  ATCODER: { name: "AtCoder", summary: "Each problem has fixed points. Ties are broken by the time of your last scoring submission plus 5 minutes per rejected attempt.",
    rank: "Ranked by total points, then by time (lower is better)." },
};

const minutes = (s: number) => Math.floor(s / 60);
export const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function useBoard(runId: string, jury?: boolean, poll = 5000) {
  return useData<Board>("/api/runs/" + runId + "/standings" + (jury ? "?jury=true" : ""), poll);
}

/** Earliest accepted time per problem: the "first to solve" highlight. */
export function firstSolves(b: Board) {
  const first: Record<number, number> = {};
  for (const row of b.standings) for (const c of row.problems)
    if (c.solved && (first[c.slot] === undefined || c.solveSeconds < first[c.slot])) first[c.slot] = c.solveSeconds;
  return first;
}

export const totalOf = (b: Board, row: Row) => (b.scoring === "ICPC" ? String(row.solved) : fmt(row.score));

function CellView({ cell, scoring, points, first }: { cell: Cell; scoring: Board["scoring"]; points: number; first: boolean }) {
  if (cell.frozen) return <td className="cell frozen" title="Submitted during the freeze: result hidden until the end"><div>?<span className="small">{cell.attempts > 0 ? cell.attempts + " tries" : ""}</span></div></td>;
  if (!cell.attempts && !cell.solved) return <td className="cell"><div /></td>;
  const wrong = cell.solved ? cell.attempts - 1 : cell.attempts;
  if (scoring === "ICPC") return (
    <td className={"cell " + (cell.solved ? (first ? "solved first" : "solved") : "failed")}
      title={cell.solved ? `Accepted at minute ${minutes(cell.solveSeconds)} after ${wrong} rejected attempt(s)${first ? " — first to solve" : ""}` : `${wrong} rejected attempt(s), not solved yet`}>
      <div>{cell.solved ? "+" + (wrong || "") : "−" + wrong}{cell.solved && <span className="small">{minutes(cell.solveSeconds)}′</span>}</div>
    </td>
  );
  const partial = scoring === "IOI" && cell.score > 0 && !cell.solved;
  return (
    <td className={"cell " + (cell.solved ? (first ? "solved first" : "solved") : partial ? "partial" : "failed")} title={`${fmt(cell.score)} of ${points} points · ${cell.attempts} attempt(s)`}>
      <div>{cell.score > 0 ? fmt(cell.score) : "−" + wrong}
        <span className="small">{cell.score > 0 ? minutes(cell.solveSeconds) + "′" : ""}{scoring !== "IOI" && wrong > 0 && cell.score > 0 ? ` −${wrong}` : ""}</span></div>
    </td>
  );
}

function Podium({ b, names }: { b: Board; names: Record<string, { display_name: string; members: string | null }> }) {
  const top = b.standings.filter((r) => (b.scoring === "ICPC" ? r.solved : r.score) > 0).slice(0, 3);
  if (top.length === 0) return null;
  const order = [top[1], top[0], top[2]];
  const cls = ["p2", "p1", "p3"];
  return (
    <div className="podium">
      {order.map((row, i) => row ? (
        <div key={row.entry} className={"place rise " + cls[i]}>
          <div className="medal">{row.rank}</div>
          <div className="name" title={names[row.entry]?.display_name}>{names[row.entry]?.display_name ?? "—"}</div>
          <div className="score">{totalOf(b, row)}<span className="small muted"> {b.scoring === "ICPC" ? "solved" : "pts"}</span></div>
          {b.scoring === "ICPC" && <div className="small muted">{minutes(row.penaltySeconds ?? 0)} min penalty</div>}
        </div>
      ) : <div key={i} className={"place empty-place " + cls[i]}><div className="medal">{cls[i][1]}</div><div className="small muted">Waiting for a solve</div></div>)}
    </div>
  );
}

export default function Standings({ runId, jury, me, poll = 5000, compactPodium, links }: { runId: string; labels?: Record<number, string>; jury?: boolean; me?: string | null; poll?: number; compactPodium?: boolean; links?: boolean }) {
  const board = useBoard(runId, jury, poll);
  const rivals = useData<string[]>("/api/me/rivals/handles");
  const isRival = (members?: string | null) => Boolean(members) && members!.split(", ").some((h) => rivals.data?.includes(h));
  // Rows whose result changed since the previous refresh flash briefly.
  const previous = useRef<Record<string, string>>({});
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!board.data) return;
    const next: Record<string, string> = {}, moved = new Set<string>();
    for (const r of board.data.standings) {
      next[r.entry] = r.rank + ":" + r.score + ":" + r.solved;
      if (previous.current[r.entry] !== undefined && previous.current[r.entry] !== next[r.entry]) moved.add(r.entry);
    }
    previous.current = next;
    if (moved.size) { setChanged(moved); const t = setTimeout(() => setChanged(new Set()), 2100); return () => clearTimeout(t); }
  }, [board.data]);

  if (board.loading) return <Loading label="Loading the scoreboard…" />;
  if (!board.data) return <ErrorBox error={board.error} />;
  const b = board.data;
  const names = Object.fromEntries(b.entries.map((e) => [e.id, e]));
  const stats = Object.fromEntries(b.problemStats.map((s) => [s.slot, s]));
  const first = firstSolves(b);
  const team = b.entries.some((e) => e.members && e.members.includes(","));
  const mine = b.standings.find((r) => r.entry === me);
  const info = SCORING_INFO[b.scoring];
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="row-between">
        <div className="row">
          <span className="tag scoring">{info?.name ?? b.scoring} scoring</span>
          {b.frozen && <Badge tone="warn">Frozen: the last minutes are hidden until results are released</Badge>}
          {jury && <Badge tone="warn">Jury view (never frozen)</Badge>}
          <span className="small muted">{b.standings.length} {team ? "teams" : "contestants"} · refreshes every {Math.round(poll / 1000)}s</span>
        </div>
        <div className="legend">
          <span><i className="ok" />Accepted</span><span><i className="first" />First to solve</span>
          {b.scoring === "IOI" && <span><i className="partial" />Partial</span>}
          <span><i className="bad" />Rejected</span><span><i className="frozen" />Frozen</span>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{info?.rank} {b.scoring === "ICPC" ? "In each cell: +n = accepted after n rejected tries, with the minute it was solved; −n = n rejected tries." : "In each cell: points earned, with the minute; −n = rejected tries without points."}</p>

      {mine && (
        <div className="my-place rise">
          <div><div className="small muted">Your place</div><div className="big">#{mine.rank}<span className="small muted"> / {b.standings.length}</span></div></div>
          <div><div className="small muted">{b.scoring === "ICPC" ? "Solved" : "Points"}</div><div className="big">{totalOf(b, mine)}</div></div>
          {mine.penaltySeconds != null && <div><div className="small muted">{b.scoring === "ICPC" ? "Penalty" : "Time"}</div><div className="big">{minutes(mine.penaltySeconds)}′</div></div>}
          {mine.rank > 1 && <div className="small muted">{(() => { const ahead = b.standings[b.standings.indexOf(mine) - 1]; return ahead ? `Next above: ${names[ahead.entry]?.display_name} with ${totalOf(b, ahead)}` : ""; })()}</div>}
        </div>
      )}

      {!compactPodium && <Podium b={b} names={names} />}

      {b.standings.length === 0 ? <Empty>No entrants yet. Registered {team ? "teams" : "contestants"} appear here as soon as the contest starts.</Empty> : (
        <div className="table-wrap">
          <table className="standings">
            <thead>
              <tr>
                <th style={{ textAlign: "center" }}>#</th><th>{team ? "Team" : "Contestant"}</th>
                <th className="right">{b.scoring === "ICPC" ? "Solved" : "Points"}</th>
                {b.scoring === "ICPC" || b.scoring === "ATCODER" ? <th className="right">{b.scoring === "ICPC" ? "Penalty" : "Time"}</th> : null}
                {b.problems.map((p) => (
                  <th key={p.slot} className="prob" title={`${stats[p.slot]?.solved ?? 0} solved of ${stats[p.slot]?.tried ?? 0} who tried`}>
                    <div className="letter">{p.label}</div>
                    {b.scoring !== "ICPC" && <div className="small muted">{p.points} pts</div>}
                    <div className="small muted">{stats[p.slot]?.solved ?? 0}/{stats[p.slot]?.tried ?? 0}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.standings.map((row) => {
                const entry = names[row.entry];
                return (
                  <tr key={row.entry} className={[row.entry === me ? "me" : "", isRival(entry?.members) ? "rival" : "", row.rank <= 3 && (b.scoring === "ICPC" ? row.solved : row.score) > 0 ? "r" + row.rank : "", changed.has(row.entry) ? "flash" : ""].join(" ")}>
                    <td className="rank">{row.rank}</td>
                    {/* The arena leaves links out: following one would leave the contest screen. */}
                    <td className="who"><strong>{links && entry?.members && !entry.members.includes(",") ? <a href={"#/u/" + entry.members}>{entry.display_name}</a> : entry?.display_name ?? "—"}</strong>{row.entry === me && <span className="tag" style={{ marginLeft: 6 }}>you</span>}
                      {isRival(entry?.members) && <span className="tag rival-tag" style={{ marginLeft: 6 }}>★ rival</span>}
                      {entry?.members && entry.members.includes(",") && <div className="small muted">{entry.members}</div>}</td>
                    <td className="right total">{totalOf(b, row)}</td>
                    {b.scoring === "ICPC" || b.scoring === "ATCODER" ? <td className="right mono">{minutes(row.penaltySeconds ?? 0)}</td> : null}
                    {row.problems.map((c) => <CellView key={c.slot} cell={c} scoring={b.scoring} points={b.problems.find((p) => p.slot === c.slot)?.points ?? 0} first={c.solved && first[c.slot] === c.solveSeconds} />)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Under each letter: how many solved / tried it. Times are minutes from the start.</p>
    </div>
  );
}
