import { useState } from "react";
import { patch, post } from "../../api";
import { useAction, useData } from "../../app";
import { Empty, ErrorBox, Loading, Stat } from "../../ui";
import { DifficultyPill, acceptance, type PracticeProblem } from "../Practice";

type Managed = {
  published: (PracticeProblem & { hidden: boolean })[];
  candidates: { version_id: string; title: string; slug: string; difficulty: string; status: string; version_number: number }[];
  tags: string[];
};

/** Chips with remove buttons plus an input that suggests existing tags. Saves on every change. */
function TagEditor({ tags, suggestions, onSave }: { tags: string[]; suggestions: string[]; onSave: (tags: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim().toLowerCase();
    if (t && !tags.includes(t) && tags.length < 8) onSave([...tags, t]);
    setText("");
  };
  return (
    <div className="tag-editor">
      {tags.map((t) => <span key={t} className="tag-chip small">{t}<button className="ghost small x" style={{ padding: 0 }} title={"Remove " + t} onClick={() => onSave(tags.filter((x) => x !== t))}>×</button></span>)}
      {tags.length < 8 && (
        <input list="practice-tags" placeholder="+ tag" value={text} maxLength={24} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} onBlur={add} />
      )}
      <datalist id="practice-tags">{suggestions.map((t) => <option key={t} value={t} />)}</datalist>
    </div>
  );
}

export default function PracticeSet() {
  const data = useData<Managed>("/api/manage/practice", 30000);
  const { busy, run } = useAction();
  const [filter, setFilter] = useState("");
  if (data.loading) return <Loading />;
  if (!data.data) return <ErrorBox error={data.error} />;
  const { published, candidates, tags } = data.data;
  const save = (p: PracticeProblem, body: Record<string, unknown>, message: string) =>
    run(async () => { await patch("/api/manage/practice/" + p.problem_id, body); data.reload(); }, message);
  const shown = published.filter((p) => (p.title + " " + p.slug + " " + p.tags.join(" ")).toLowerCase().includes(filter.toLowerCase()));
  const commonTags = ["implementation", "math", "greedy", "dp", "graphs", "strings", "sorting", "binary search", "data structures", "brute force", "number theory", "two pointers"];
  const suggestions = [...new Set([...tags, ...commonTags])].sort();

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Problem lab</div><h1>Practice set</h1>
          <p>Public problems anyone signed in can solve on the Practice page. Add approved problems, tag them by topic so people can filter, and hide one at any time.</p></div>
        <a className="btn" href="#/practice">Open the Practice page ↗</a>
      </div>

      <div className="stat-tiles">
        <Stat label="Public problems" value={published.filter((p) => !p.hidden).length} tone="ok" />
        <Stat label="Hidden" value={published.filter((p) => p.hidden).length} />
        <Stat label="Ready to add" value={candidates.length} tone={candidates.length ? "warn" : undefined} />
        <Stat label="Accepted solutions" value={published.reduce((n, p) => n + Number(p.accepted), 0)} />
      </div>

      <section className="card stack">
        <div className="section-title"><h3>Add problems</h3><span className="count">{candidates.length}</span></div>
        {candidates.length === 0 ? (
          <Empty>Every approved problem is already in practice. Create one in the Problem lab (+ New problem); once it is validated and approved it appears here.</Empty>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Problem</th><th>Difficulty</th><th>Version</th><th /></tr></thead>
            <tbody>{candidates.map((c) => {
              const replaces = published.find((p) => p.slug === c.slug);
              return (
                <tr key={c.version_id}>
                  <td><strong>{c.title}</strong><div className="small muted mono">{c.slug}</div></td>
                  <td><DifficultyPill value={c.difficulty} /></td>
                  <td className="small">v{c.version_number}{replaces ? <span className="muted"> · replaces the public version</span> : ""}</td>
                  <td className="right"><button className="primary small" disabled={busy}
                    onClick={() => run(async () => { await post("/api/lab/problems/" + c.version_id + "/publish-practice"); data.reload(); }, replaces ? "Practice version updated" : "Added to practice")}>
                    {replaces ? "Update public version" : "+ Add to practice"}</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>

      <section className="card stack">
        <div className="row-between">
          <div className="section-title" style={{ margin: 0 }}><h3>Published</h3><span className="count">{published.length}</span></div>
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 240 }} />
        </div>
        {published.length === 0 ? <Empty>Nothing published yet.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Problem</th><th>Difficulty</th><th>Topics</th><th className="right">Solved by</th><th className="right">Acceptance</th><th>Visibility</th><th /></tr></thead>
            <tbody>{shown.map((p) => {
              const rate = acceptance(p);
              return (
                <tr key={p.problem_id} className={p.hidden ? "hidden-row" : ""}>
                  <td><strong>{p.title}</strong><div className="small muted mono">{p.slug}</div></td>
                  <td><DifficultyPill value={p.difficulty} /></td>
                  <td style={{ minWidth: 240 }}><TagEditor tags={p.tags} suggestions={suggestions} onSave={(next) => save(p, { tags: next }, "Topics saved")} /></td>
                  <td className="right mono">{p.solved_by}<span className="small muted"> / {p.tried_by}</span></td>
                  <td className="right mono">{rate == null ? "—" : rate + "%"}</td>
                  <td>{p.hidden ? <span className="badge neutral">Hidden</span> : <span className="badge ok">Public</span>}</td>
                  <td className="right"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    {!p.hidden && <a className="btn small ghost" href={"#/practice/" + p.id}>Open</a>}
                    <button className="small" disabled={busy} onClick={() => save(p, { hidden: !p.hidden, reason: p.hidden ? "Shown again" : "Hidden from practice" }, p.hidden ? "Visible in practice again" : "Hidden from practice")}>{p.hidden ? "Show" : "Hide"}</button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <span className="small muted">Topics appear as filters on the Practice page (up to 8 per problem). Press Enter to add one. Hidden problems keep their statistics.</span>
      </section>
    </div>
  );
}
