import { useState } from "react";
import { patch, post } from "../../api";
import { useAction, useData } from "../../app";
import { Empty, ErrorBox, Loading, Stat } from "../../ui";
import { DifficultyPill } from "../Practice";

type Managed = {
  pool: { problem_id: string; id: string; title: string; slug: string; difficulty: string; version_number: number; hidden: boolean; published_at: string; rounds_played: number }[];
  candidates: { version_id: string; title: string; slug: string; difficulty: string; status: string; version_number: number }[];
};

/** The duel problem pool: duels draw their rounds from here only, never from Practice. */
export default function DuelProblems() {
  const data = useData<Managed>("/api/manage/duel-problems", 30000);
  const { busy, run } = useAction();
  const [filter, setFilter] = useState("");
  if (data.loading) return <Loading />;
  if (!data.data) return <ErrorBox error={data.error} />;
  const { pool, candidates } = data.data;
  const active = pool.filter((p) => !p.hidden);
  const count = (d: string) => active.filter((p) => p.difficulty === d).length;
  const shown = pool.filter((p) => (p.title + " " + p.slug).toLowerCase().includes(filter.toLowerCase()));
  const add = (versionId: string, replaces: boolean) =>
    run(async () => { await post("/api/lab/problems/" + versionId + "/publish-duel"); data.reload(); }, replaces ? "Duel version updated" : "Added to duels");
  const toggle = (p: Managed["pool"][number]) =>
    run(async () => { await patch("/api/manage/duel-problems/" + p.problem_id, { hidden: !p.hidden }); data.reload(); }, p.hidden ? "Back in duels" : "Hidden from duels");

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Problem lab</div><h1>Duel problems</h1>
          <p>Duels draw their rounds from this pool only. These problems are not shown on the Practice page, so players meet them for the first time in a duel.
            Keep them short: a round lasts a few minutes. A best of 5 needs at least 5 visible problems (of the chosen level).</p></div>
        <a className="btn primary" href="#/admin/duel-problems/import">Bulk import duel problems</a>
      </div>

      <div className="stat-tiles">
        <Stat label="In duels" value={active.length} tone={active.length >= 5 ? "ok" : "warn"} hint={active.length < 5 ? "Best of 5 needs 5" : undefined} />
        <Stat label="Easy · Medium · Hard" value={`${count("EASY")} · ${count("MEDIUM")} · ${count("HARD")}`} />
        <Stat label="Hidden" value={pool.length - active.length} />
        <Stat label="Rounds played" value={pool.reduce((n, p) => n + Number(p.rounds_played), 0)} />
      </div>

      <section className="card stack">
        <div className="row-between">
          <div className="section-title" style={{ margin: 0 }}><h3>In the pool</h3><span className="count">{pool.length}</span></div>
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 240 }} />
        </div>
        {pool.length === 0 ? <Empty>No duel problems yet. Use <strong>Bulk import duel problems</strong>, or add an approved problem below.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Problem</th><th>Difficulty</th><th>Version</th><th className="right">Rounds played</th><th>In duels</th><th /></tr></thead>
            <tbody>{shown.map((p) => (
              <tr key={p.problem_id} className={p.hidden ? "hidden-row" : ""}>
                <td><strong>{p.title}</strong><div className="small muted mono">{p.slug}</div></td>
                <td><DifficultyPill value={p.difficulty} /></td>
                <td className="small">v{p.version_number}</td>
                <td className="right mono">{p.rounds_played}</td>
                <td>{p.hidden ? <span className="badge neutral">Hidden</span> : <span className="badge ok">Yes</span>}</td>
                <td className="right"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                  <a className="btn small ghost" href={"#/admin/problems/" + p.id}>Open</a>
                  <button className="small" disabled={busy} onClick={() => toggle(p)}>{p.hidden ? "Show" : "Hide"}</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <span className="small muted">Hiding a problem stops new duels from drawing it; duels already running keep their rounds.</span>
      </section>

      <section className="card stack">
        <div className="section-title"><h3>Add approved problems</h3><span className="count">{candidates.length}</span></div>
        {candidates.length === 0 ? <Empty>Every approved problem is already in the pool. New problems appear here once validated and approved in the Problem lab.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Problem</th><th>Difficulty</th><th>Version</th><th /></tr></thead>
            <tbody>{candidates.map((c) => {
              const replaces = pool.some((p) => p.slug === c.slug);
              return (
                <tr key={c.version_id}>
                  <td><strong>{c.title}</strong><div className="small muted mono">{c.slug}</div></td>
                  <td><DifficultyPill value={c.difficulty} /></td>
                  <td className="small">v{c.version_number}{c.status === "PUBLISHED" ? <span className="muted"> · also used elsewhere (practice or contests)</span> : ""}{replaces ? <span className="muted"> · replaces the duel version</span> : ""}</td>
                  <td className="right"><button className="primary small" disabled={busy} onClick={() => add(c.version_id, replaces)}>{replaces ? "Update duel version" : "+ Add to duels"}</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
