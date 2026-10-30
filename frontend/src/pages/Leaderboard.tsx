import { navigate, useData, useRoute } from "../app";
import { Avatar, TierChip } from "../components/Avatar";
import { Empty, ErrorBox, Loading, when } from "../ui";

type Totals = { rank: number; score: number; solved: number; easy: number; medium: number; hard: number; last_solved_at: string };
type Player = Totals & { handle: string; display_name: string; tier: string };
type Team = Totals & { id: string; name: string; members: string | null };
type Data = {
  players: Player[]; teams: Team[]; playerCount: number; teamCount: number;
  me: Player | null; myTeams: Team[]; values: { EASY: number; MEDIUM: number; HARD: number }; tiers: { name: string; from: number }[];
};
/** One row of either board, so both share the same podium and table. */
type Line = { key: string; title: string; subtitle?: string | null; mine: boolean; rival?: boolean; href: string; avatar: string; tier?: string; totals: Totals };

const sigma = (n: number) => "Σ " + n.toLocaleString();

function Podium({ lines }: { lines: Line[] }) {
  const order = [lines[1], lines[0], lines[2]], cls = ["p2", "p1", "p3"];
  return (
    <div className="podium">
      {order.map((line, i) => line ? (
        <div key={line.key} className={"place rise " + cls[i]}>
          <div className="medal">{line.totals.rank}</div>
          <a href={line.href} className="podium-person"><Avatar handle={line.avatar} size={44} tier={line.tier} /><div className="name" title={line.title}>{line.title}</div></a>
          {line.subtitle && <div className="small muted sigma-subtitle" title={line.subtitle}>{line.subtitle}</div>}
          <div className="score">{sigma(line.totals.score)}</div>
          <div className="small muted">{line.totals.solved} solved</div>
        </div>
      ) : <div key={i} className={"place empty-place " + cls[i]}><div className="medal">{cls[i][1]}</div><div className="small muted">Still open</div></div>)}
    </div>
  );
}

function Board({ lines, who }: { lines: Line[]; who: string }) {
  return (
    <div className="table-wrap">
      <table className="standings">
        <thead>
          <tr>
            <th style={{ textAlign: "center" }}>#</th><th>{who}</th><th className="right">Sigma</th><th className="right">Solved</th>
            <th className="right" title="Easy problems">E</th><th className="right" title="Medium problems">M</th><th className="right" title="Hard problems">H</th><th>Last solve</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ key, title, subtitle, mine, rival, href, avatar, tier, totals: t }) => (
            <tr key={key} className={[mine ? "me" : "", rival ? "rival" : "", t.rank <= 3 ? "r" + t.rank : ""].join(" ")}>
              <td className="rank">{t.rank}</td>
              <td className="who">
                <div className="row" style={{ gap: "0.65rem", flexWrap: "nowrap" }}>
                  <Avatar handle={avatar} size={34} tier={tier} />
                  <div style={{ minWidth: 0 }}>
                    <strong><a href={href}>{title}</a></strong>{mine && <span className="tag" style={{ marginLeft: 6 }}>you</span>}
                    {rival && <span className="tag rival-tag" style={{ marginLeft: 6 }}>★ rival</span>}
                    {tier && <span style={{ marginLeft: 8 }}><TierChip tier={tier} /></span>}
                    {subtitle && <div className="small muted">{subtitle}</div>}
                  </div>
                </div>
              </td>
              <td className="right total sigma-total">{sigma(t.score)}</td>
              <td className="right mono">{t.solved}</td>
              <td className="right mono sigma-easy">{t.easy}</td>
              <td className="right mono sigma-medium">{t.medium}</td>
              <td className="right mono sigma-hard">{t.hard}</td>
              <td className="small muted">{when(t.last_solved_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MyPlace({ label, name, totals, count, next }: { label: string; name?: string; totals: Totals; count: number; next?: Totals }) {
  return (
    <div className="my-place rise">
      <div><div className="small muted">{label}</div><div className="big">#{totals.rank}<span className="small muted"> / {count}</span></div></div>
      <div><div className="small muted">Sigma</div><div className="big">{sigma(totals.score)}</div></div>
      {name && <strong>{name}</strong>}
      {next && <div className="small muted">{(next.score - totals.score).toLocaleString()} Σ to the next place</div>}
    </div>
  );
}

export default function Leaderboard() {
  const { parts } = useRoute();
  const tab = parts[1] === "teams" ? "teams" : "players";
  const board = useData<Data>("/api/leaderboard", 30000);
  const d = board.data;
  const rivals = useData<string[]>("/api/me/rivals/handles");
  const myTeamIds = new Set((d?.myTeams ?? []).map((t) => t.id));
  const lines: Line[] = !d ? [] : tab === "players"
    ? d.players.map((p) => ({ key: p.handle, title: p.display_name, subtitle: "@" + p.handle, mine: p.handle === d.me?.handle, rival: rivals.data?.includes(p.handle), href: "#/u/" + p.handle, avatar: p.handle, tier: p.tier, totals: p }))
    : d.teams.map((t) => ({ key: t.id, title: t.name, subtitle: t.members, mine: myTeamIds.has(t.id), href: "#/team/" + t.id, avatar: "team:" + t.id, totals: t }));
  const above = (rank: number) => (tab === "players" ? d?.players : d?.teams)?.[rank - 2];
  return (
    <main className="page">
      <section className="hero sigma-hero">
        <div className="eyebrow" style={{ color: "#35c7e8" }}>InfoM4th Arena</div>
        <h1>Sigma Leaderboard</h1>
        <p>Every problem you solve adds to your Sigma. The sum never lies.</p>
        <div className="hero-stats">
          <div><strong>{d?.playerCount ?? "–"}</strong><span>Players ranked</span></div>
          <div><strong>{d?.teamCount ?? "–"}</strong><span>Teams ranked</span></div>
        </div>
        <span className="sigma-mark" aria-hidden>Σ</span>
      </section>

      <div className="row-between" style={{ marginBottom: "1rem" }}>
        <div className="filters" role="tablist">
          <button role="tab" aria-selected={tab === "players"} className={tab === "players" ? "active" : ""} onClick={() => navigate("/leaderboard")}>Players</button>
          <button role="tab" aria-selected={tab === "teams"} className={tab === "teams" ? "active" : ""} onClick={() => navigate("/leaderboard/teams")}>Teams</button>
        </div>
        <span className="small muted">Updates every 30 seconds</span>
      </div>

      <ErrorBox error={board.error} />
      {board.loading ? <Loading label="Adding up the Sigma…" /> : d && (
        <div className="stack" style={{ gap: "1rem" }}>
          {tab === "players" && d.me && <MyPlace label="Your place" totals={d.me} count={d.playerCount} next={above(d.me.rank)} />}
          {tab === "teams" && d.myTeams.map((t) => <MyPlace key={t.id} label="Your team" name={t.name} totals={t} count={d.teamCount} next={above(t.rank)} />)}
          {lines.length === 0 ? <Empty>{tab === "players" ? "Nobody is on the board yet. Solve a practice problem and take first place." : "No team is on the board yet. Team members earn Sigma for their team by solving problems."}</Empty> : (
            <>
              <Podium lines={lines.slice(0, 3)} />
              <Board lines={lines} who={tab === "players" ? "Player" : "Team"} />
            </>
          )}
          <details className="card sigma-rules">
            <summary>How Sigma works</summary>
            <ul>
              <li>Each problem pays once: Easy {d.values.EASY}, Medium {d.values.MEDIUM}, Hard {d.values.HARD}.</li>
              <li>Rare problems pay up to 50% more. The bonus shrinks as more players solve them, so every score can move.</li>
              <li>Practice solves count, and so do solves from public contests once their results are final.</li>
              <li>A team earns from its team contests and from what members solve after joining. Each problem still pays the team once.</li>
              <li>Example runs, rehearsals and private contests do not count. Staff accounts are not ranked because they can read the tests.</li>
              <li>Equal scores: whoever got there first ranks higher.</li>
            </ul>
            <strong className="small">Player tiers</strong>
            <div className="tier-list">
              {d.tiers.map((t) => <span key={t.name} className="row small" style={{ gap: "0.35rem" }}><TierChip tier={t.name} /><span className="muted">from Σ {t.from.toLocaleString()}</span></span>)}
            </div>
          </details>
        </div>
      )}
    </main>
  );
}
