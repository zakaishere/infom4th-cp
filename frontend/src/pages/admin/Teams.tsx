import { useEffect, useState } from "react";
import { useData } from "../../app";
import { Badge, Empty, ErrorBox, Field, Loading, Stat, when } from "../../ui";

type TeamRow = {
  id: string; name: string; created_at: string; captain: string; captain_id: string; members: string | null; member_count: number; contests: number; submissions: number;
  last_contest: string | null; last_contest_id: string | null; last_played_at: string | null; locked: boolean;
};

export function Teams() {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [activity, setActivity] = useState("");
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [search]);
  const params = new URLSearchParams({ offset: String(offset) });
  if (q) params.set("q", q); if (activity) params.set("activity", activity);
  const data = useData<{ teams: TeamRow[]; total: number; summary: { teams: number; played: number; locked: number } }>("/api/admin/teams?" + params, 30000);
  const total = data.data?.total ?? 0;
  const s = data.data?.summary;
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Teams</h1><p>Every team, who is in it, and what it played. A locked team is registered in a scheduled or running contest, so nobody can join it.</p></div></div>
      <div className="stat-tiles">
        <Stat label="Teams" value={s?.teams ?? "…"} />
        <Stat label="Have played" value={s?.played ?? "…"} />
        <Stat label="Never played" value={s ? s.teams - s.played : "…"} />
        <Stat label="Locked now" value={s?.locked ?? "…"} />
      </div>
      <div className="card row" style={{ alignItems: "flex-end" }}>
        <Field label="Search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Team name, member handle or email" style={{ minWidth: 280 }} /></Field>
        <Field label="Activity"><select value={activity} onChange={(e) => { setActivity(e.target.value); setOffset(0); }}>
          <option value="">All teams</option><option value="played">Have played</option><option value="never">Never played</option><option value="locked">Locked now</option></select></Field>
        {(search || activity) && <button className="small" onClick={() => { setSearch(""); setActivity(""); }}>Clear filters</button>}
      </div>
      <ErrorBox error={data.error} />
      {data.loading ? <Loading /> : !data.data?.teams.length ? <Empty>No team matches.</Empty> : (
        <div className="card table-wrap"><table>
          <thead><tr><th>Team</th><th>Members</th><th>Contests</th><th>Last played</th><th>Submissions</th><th>Created</th><th /></tr></thead>
          <tbody>{data.data.teams.map((t) => (
            <tr key={t.id}>
              <td><a href={"#/admin/teams/" + t.id}><strong>{t.name}</strong></a> {t.locked && <Badge tone="warn">Locked</Badge>}<div className="small muted">Captain <a href={"#/admin/users/" + t.captain_id}>@{t.captain}</a></div></td>
              <td className="small">{t.member_count}<div className="muted">{t.members}</div></td>
              <td className="small">{t.contests}</td>
              <td className="small">{t.last_contest ? <><a href={"#/admin/contests/" + t.last_contest_id}>{t.last_contest}</a><div className="muted">{when(t.last_played_at)}</div></> : <span className="muted">Never</span>}</td>
              <td className="small">{t.submissions}</td>
              <td className="small">{when(t.created_at)}</td>
              <td className="right"><a className="btn small" href={"#/admin/teams/" + t.id}>Details</a></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="row"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button>
        <span className="small muted">{total ? `${offset + 1}–${Math.min(offset + 100, total)} of ${total}` : ""}</span>
        <button disabled={offset + 100 >= total} onClick={() => setOffset(offset + 100)}>Next</button></div>
    </div>
  );
}

export function TeamDetail({ id }: { id: string }) {
  const team = useData<any>("/api/admin/teams/" + id, 30000);
  if (team.error && !team.data) return <ErrorBox error={team.error} />;
  if (!team.data) return <Loading />;
  const t = team.data;
  const best = (t.contests as any[]).filter((c) => c.kind === "OFFICIAL" && c.rank != null).reduce((b: number | null, c) => (b == null || c.rank < b ? c.rank : b), null);
  return (
    <div className="stack">
      <a href="#/admin/teams" className="small">← All teams</a>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>{t.name}</h1><p>Captain <a href={"#/admin/users/" + t.captain_id}>@{t.captain}</a> · created {when(t.created_at)}</p></div>
        {t.locked && <Badge tone="warn">Locked: registered in a scheduled or running contest</Badge>}
      </div>
      <div className="stat-tiles">
        <Stat label="Members" value={t.members.length} />
        <Stat label="Official contests" value={t.contests.filter((c: any) => c.kind === "OFFICIAL").length} />
        <Stat label="Best rank" value={best ?? "—"} />
        <Stat label="Submissions" value={t.members.reduce((n: number, m: any) => n + Number(m.submissions), 0)} hint="by current members" />
      </div>
      <section className="card stack">
        <h3 style={{ margin: 0 }}>Members</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>User</th><th>Status</th><th>Joined</th><th>Team submissions</th></tr></thead>
          <tbody>{t.members.map((m: any) => (
            <tr key={m.id}>
              <td><a href={"#/admin/users/" + m.id}><strong>{m.display_name}</strong></a> {m.id === t.captain_id && <Badge tone="info">Captain</Badge>}<div className="small muted">@{m.handle}</div></td>
              <td><Badge tone={m.status === "ACTIVE" ? "ok" : "bad"}>{m.status}</Badge></td>
              <td className="small">{when(m.joined_at)}</td><td className="small">{m.submissions}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="card stack">
        <h3 style={{ margin: 0 }}>Contests played</h3>
        {!t.contests.length ? <Empty>This team has not played yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Contest</th><th>Started</th><th>Rank</th><th>Solved</th><th>Submissions</th><th>Played as</th></tr></thead>
            <tbody>{t.contests.map((c: any) => (
              <tr key={c.run_id}>
                <td><a href={"#/admin/contests/" + c.competition_id}><strong>{c.title}</strong></a> {c.kind === "REHEARSAL" && <Badge tone="warn">Rehearsal</Badge>} {c.status === "RUNNING" && <Badge tone="ok">Live</Badge>}<div className="small muted">{c.scoring} scoring</div></td>
                <td className="small">{when(c.starts_at)}</td>
                <td className="small">{c.rank != null ? <><strong>{c.rank}</strong> of {c.entrants}</> : "—"}</td>
                <td className="small">{c.solved ?? "—"} of {c.problems}</td>
                <td className="small">{c.submissions}</td>
                <td className="small">{c.display_name}<div className="muted">{c.members}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <span className="small muted">Shows the 30 most recent. Members are who played at the time, which can differ from today's team. Ranks ignore any scoreboard freeze.</span>
      </section>
      {t.registrations.length > 0 && (
        <section className="card stack">
          <h3 style={{ margin: 0 }}>Registered, not played yet</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>Contest</th><th>Contest status</th><th>Registration</th><th>Registered</th></tr></thead>
            <tbody>{t.registrations.map((r: any) => (
              <tr key={r.competition_id}>
                <td><a href={"#/admin/contests/" + r.competition_id}><strong>{r.title}</strong></a></td>
                <td className="small">{r.competition_status}</td><td className="small">{r.status}</td><td className="small">{when(r.created_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
