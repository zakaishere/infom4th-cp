import { useData } from "../app";
import { Avatar, TierChip } from "../components/Avatar";
import { Empty, ErrorBox, Loading, when } from "../ui";

type Side = { handle: string; display_name: string; sigma: number | null; rank: number | null; tier: string | null; solved: number; rating: number | null };
type Problem = { title: string; difficulty: string; version_id: string | null };
type Data = {
  a: Side; b: Side; record: { a: number; b: number; draws: number; teammates: number }; both: number;
  contests: { run_id: string; title: string; starts_at: string; a_rank: number; b_rank: number; entrants: number; teammates: boolean }[];
  onlyA: Problem[]; onlyB: Problem[];
};

function Person({ side }: { side: Side }) {
  return (
    <a href={"#/u/" + side.handle} className="versus-person">
      <Avatar handle={side.handle} size={72} tier={side.tier} />
      <strong>{side.display_name}</strong>
      <span className="small muted">@{side.handle}</span>
      <TierChip tier={side.tier} />
    </a>
  );
}

/** The better value is marked with a triangle as well as weight, so it never relies on color. */
function Compare({ label, a, b, lowerWins, show = (v) => v.toLocaleString() }: { label: string; a: number | null; b: number | null; lowerWins?: boolean; show?: (v: number) => string }) {
  const aWins = a != null && (b == null || (lowerWins ? a < b : a > b));
  const bWins = b != null && (a == null || (lowerWins ? b < a : b > a));
  return (
    <div className="versus-row">
      <span className={"mono" + (aWins ? " wins" : "")}>{aWins && "▶ "}{a == null ? "–" : show(a)}</span>
      <span className="small muted">{label}</span>
      <span className={"mono" + (bWins ? " wins" : "")}>{b == null ? "–" : show(b)}{bWins && " ◀"}</span>
    </div>
  );
}

function ProblemList({ title, problems }: { title: string; problems: Problem[] }) {
  return (
    <section className="card stack">
      <h3>{title}</h3>
      {problems.length === 0 ? <Empty>Nothing here.</Empty> : problems.map((p) => (
        <div key={p.title + p.version_id} className="row-between person">
          <span>{p.version_id ? <a href={"#/practice/" + p.version_id}>{p.title}</a> : p.title}</span>
          <span className="tag">{p.difficulty}</span>
        </div>
      ))}
    </section>
  );
}

export default function HeadToHead({ first, second }: { first: string; second: string }) {
  const versus = useData<Data>(`/api/profiles/${first}/vs/${second}`);
  if (versus.loading) return <main className="page"><Loading label="Setting up the match…" /></main>;
  if (!versus.data) return <main className="page"><ErrorBox error={versus.error} /></main>;
  const { a, b, record, contests, onlyA, onlyB, both } = versus.data;
  return (
    <main className="page">
      <section className="hero versus-hero">
        <Person side={a} />
        <div className="versus-score">
          <div className="eyebrow" style={{ color: "#35c7e8" }}>Head to head</div>
          <strong className="mono">{record.a} – {record.b}</strong>
          <span className="small">{record.draws ? `${record.draws} draw${record.draws === 1 ? "" : "s"} · ` : ""}{record.teammates ? `${record.teammates} as teammates` : contests.length === 0 ? "No shared contests yet" : `${contests.length} shared contest${contests.length === 1 ? "" : "s"}`}</span>
        </div>
        <Person side={b} />
      </section>
      <div className="stack" style={{ gap: "1.25rem" }}>
        <section className="card versus-table">
          <Compare label="Sigma" a={a.sigma} b={b.sigma} show={(v) => "Σ " + v.toLocaleString()} />
          <Compare label="Place" a={a.rank} b={b.rank} lowerWins show={(v) => "#" + v} />
          <Compare label="Rating" a={a.rating} b={b.rating} />
          <Compare label="Solved" a={a.solved} b={b.solved} />
          <p className="small muted" style={{ margin: "0.6rem 0 0", textAlign: "center" }}>{both} problem{both === 1 ? "" : "s"} solved by both</p>
        </section>
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <ProblemList title={`Only @${a.handle} solved`} problems={onlyA} />
          <ProblemList title={`Only @${b.handle} solved`} problems={onlyB} />
        </div>
        <section className="card stack">
          <h3>Shared contests</h3>
          {contests.length === 0 ? <Empty>They have not met in a finished public contest yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Contest</th><th className="right">@{a.handle}</th><th className="right">@{b.handle}</th></tr></thead>
                <tbody>{contests.map((c) => (
                  <tr key={c.run_id}>
                    <td><strong>{c.title}</strong><div className="small muted">{when(c.starts_at)}{c.teammates ? " · Same team" : ""}</div></td>
                    <td className="right mono">#{c.a_rank}</td><td className="right mono">#{c.b_rank}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
