import { useData } from "../app";
import { Avatar, TierChip } from "../components/Avatar";
import { SCORING_INFO } from "../components/Standings";
import { Empty, ErrorBox, Loading, UserList, when } from "../ui";
import { MedalRow, type ContestRow } from "./Profile";

type Data = {
  id: string; name: string; created_at: string; captain: string; teamCount: number;
  sigma: { rank: number; score: number; solved: number; easy: number; medium: number; hard: number } | null;
  members: { handle: string; display_name: string; sigma: number | null; tier: string | null; rating: number | null }[];
  medals: { gold: number; silver: number; bronze: number };
  contests: ContestRow[];
};

export default function TeamProfile({ id }: { id: string }) {
  const team = useData<Data>("/api/teams/" + id + "/profile");
  if (team.loading) return <main className="page"><Loading label="Loading the team…" /></main>;
  if (!team.data) return <main className="page"><ErrorBox error={team.error} /></main>;
  const t = team.data;
  return (
    <main className="page">
      <section className="hero profile-hero">
        <div className="profile-head">
          <Avatar handle={"team:" + t.id} size={104} />
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ color: "#35c7e8" }}>Team</div>
            <h1>{t.name}</h1>
            <div className="row profile-tags"><span>Captain <a href={"#/u/" + t.captain}>@{t.captain}</a></span></div>
          </div>
        </div>
        <div className="hero-stats">
          <div><strong className="mono">{t.sigma ? "Σ " + t.sigma.score.toLocaleString() : "–"}</strong><span>{t.sigma ? `#${t.sigma.rank} of ${t.teamCount}` : "Not ranked yet"}</span></div>
          <div><strong>{t.sigma?.solved ?? 0}</strong><span>Solved</span></div>
          <div><strong>{t.contests.length}</strong><span>Contests</span></div>
          <div><MedalRow medals={t.medals} /><span>Medals</span></div>
        </div>
      </section>
      <div className="stack" style={{ gap: "1.25rem" }}>
        <section className="card stack">
          <h3>Members</h3>
          {t.members.length === 0 ? <Empty>No active members.</Empty> : t.members.map((m) => (
            <a key={m.handle} href={"#/u/" + m.handle} className="row-between person">
              <span className="row" style={{ gap: "0.6rem", minWidth: 0 }}>
                <Avatar handle={m.handle} size={34} tier={m.tier} />
                <span><strong>{m.display_name}</strong><div className="small muted">@{m.handle}</div></span>
              </span>
              <span className="row" style={{ gap: "0.75rem" }}><TierChip tier={m.tier} /><span className="mono small">{m.sigma != null ? "Σ " + m.sigma.toLocaleString() : "–"}</span></span>
            </a>
          ))}
        </section>
        <section className="card stack">
          <h3>Contest history</h3>
          {t.contests.length === 0 ? <Empty>No finished public contests yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Contest</th><th>Played by</th><th className="right">Place</th><th className="right">Solved</th></tr></thead>
                <tbody>{t.contests.map((c) => (
                  <tr key={c.run_id}>
                    <td><strong>{c.title}</strong><div className="small muted">{when(c.starts_at)} · {SCORING_INFO[c.scoring_system]?.name ?? c.scoring_system}</div></td>
                    <td className="small"><UserList handles={c.members} /></td>
                    <td className="right mono">#{c.rank} / {c.entrants}</td><td className="right mono">{c.solved}</td>
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
