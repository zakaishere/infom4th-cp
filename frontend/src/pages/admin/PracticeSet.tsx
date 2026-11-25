import { useMemo, useState } from "react";
import { patch, post } from "../../api";
import { navigate, useAction, useData } from "../../app";
import { Empty, ErrorBox, FlagBadge, Loading, Stat, formatProblemFlag, queueProblemsForContest } from "../../ui";
import { STANDARD_TOPICS } from "../../lib/topics";
import { DifficultyPill, acceptance, type PracticeProblem } from "../Practice";

type PublishedRow = PracticeProblem & { hidden: boolean; contest_flag?: string | null };
type CandidateRow = { problem_id?: string; version_id: string; title: string; slug: string; difficulty: string; status: string; version_number: number; contest_flag?: string | null };
type Managed = {
  published: PublishedRow[];
  candidates: CandidateRow[];
  tags: string[];
};

const DIFF_RANK: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3 };

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

function inferContestKind(flags: (string | null | undefined)[]): "BASIC" | "WARMUP" | "STANDARD" | undefined {
  const unique = [...new Set(flags.filter(Boolean))];
  if (unique.length === 1 && (unique[0] === "BASIC" || unique[0] === "WARMUP" || unique[0] === "STANDARD")) return unique[0];
  return undefined;
}

export default function PracticeSet() {
  const data = useData<Managed>("/api/manage/practice", 30000);
  const { busy, run } = useAction();
  const [q, setQ] = useState("");
  const [difficulty, setDifficulty] = useState<"" | "EASY" | "MEDIUM" | "HARD">("");
  const [flagFilter, setFlagFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState<"" | "PROBLEM_SET" | "TD" | "PUBLIC" | "HIDDEN">("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<"newest" | "easiest" | "hardest" | "popular" | "title">("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customFlag, setCustomFlag] = useState("");

  const published = data.data?.published ?? [];
  const candidates = data.data?.candidates ?? [];
  const tags = data.data?.tags ?? [];

  const allFlags = useMemo(() => {
    const custom = new Set<string>();
    for (const p of published) if (p.contest_flag && !["BASIC", "WARMUP", "STANDARD"].includes(p.contest_flag)) custom.add(p.contest_flag);
    for (const c of candidates) if (c.contest_flag && !["BASIC", "WARMUP", "STANDARD"].includes(c.contest_flag)) custom.add(c.contest_flag);
    return ["BASIC", "WARMUP", "STANDARD", ...[...custom].sort()];
  }, [published, candidates]);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rows = published.filter((p) => {
      if (query && !(p.title + " " + p.slug + " " + p.tags.join(" ") + " " + (p.contest_flag ?? "")).toLowerCase().includes(query)) return false;
      if (difficulty && p.difficulty !== difficulty) return false;
      if (flagFilter === "__NONE__" && p.contest_flag) return false;
      if (flagFilter && flagFilter !== "__NONE__" && p.contest_flag !== flagFilter) return false;
      if (sectionFilter === "PROBLEM_SET" && p.td_number != null) return false;
      if (sectionFilter === "TD" && p.td_number == null) return false;
      if (sectionFilter === "PUBLIC" && p.hidden) return false;
      if (sectionFilter === "HIDDEN" && !p.hidden) return false;
      if (tagFilter && !p.tags.includes(tagFilter)) return false;
      return true;
    });
    const sorters: Record<typeof sort, (a: PublishedRow, b: PublishedRow) => number> = {
      newest: (a, b) => b.published_at.localeCompare(a.published_at),
      easiest: (a, b) => (DIFF_RANK[a.difficulty] ?? 2) - (DIFF_RANK[b.difficulty] ?? 2) || a.title.localeCompare(b.title),
      hardest: (a, b) => (DIFF_RANK[b.difficulty] ?? 2) - (DIFF_RANK[a.difficulty] ?? 2) || a.title.localeCompare(b.title),
      popular: (a, b) => b.solved_by - a.solved_by,
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return [...rows].sort(sorters[sort]);
  }, [published, q, difficulty, flagFilter, sectionFilter, tagFilter, sort]);

  if (data.loading) return <Loading />;
  if (!data.data) return <ErrorBox error={data.error} />;

  const save = (p: PracticeProblem, body: Record<string, unknown>, message: string) =>
    run(async () => { await patch("/api/manage/practice/" + p.problem_id, body); data.reload(); }, message);

  const flagProblems = (ids: string[], flag: string | null) =>
    run(async () => {
      await post("/api/lab/problems/flag", { ids, flag });
      data.reload();
    }, flag ? `Flagged as ${formatProblemFlag(flag)}` : "Flag cleared");

  const suggestions = [...new Set([...tags, ...STANDARD_TOPICS])].sort();

  const toggleOne = (versionId: string) => setSelected((old) => {
    const next = new Set(old);
    if (next.has(versionId)) next.delete(versionId);
    else next.add(versionId);
    return next;
  });
  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.id));
  const toggleAllShown = () => setSelected((old) => {
    const next = new Set(old);
    if (allShownSelected) shown.forEach((p) => next.delete(p.id));
    else shown.forEach((p) => next.add(p.id));
    return next;
  });

  const selectedRows = published.filter((p) => selected.has(p.id));
  const hasFilters = Boolean(q || difficulty || flagFilter || sectionFilter || tagFilter);

  const launchContestWithSelected = () => {
    if (!selectedRows.length) return;
    queueProblemsForContest(selectedRows.map((p) => p.id), inferContestKind(selectedRows.map((p) => p.contest_flag)));
    navigate("/admin/contests/new");
  };

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Problem lab</div><h1>Problem Set</h1>
          <p>Filter, tag, and flag problems for Basic, Warmup, or Normal contests — or select problems directly to spin up a new contest.</p></div>
        <div className="row">
          <a className="btn" href="#/admin/problems">Problem lab</a>
          <a className="btn" href="#/">Open Problem Set ↗</a>
        </div>
      </div>

      <div className="stat-tiles">
        <Stat label="Public problems" value={published.filter((p) => !p.hidden).length} tone="ok" />
        <Stat label="Flagged for contests" value={published.filter((p) => p.contest_flag).length} tone="info" />
        <Stat label="Ready to add" value={candidates.length} tone={candidates.length ? "warn" : undefined} />
        <Stat label="Accepted solutions" value={published.reduce((n, p) => n + Number(p.accepted), 0)} />
      </div>

      <section className="card stack">
        <div className="row-between">
          <div className="section-title" style={{ margin: 0 }}><h3>Published</h3><span className="count">{shown.length} / {published.length}</span></div>
          {hasFilters && <button className="ghost small" onClick={() => { setQ(""); setDifficulty(""); setFlagFilter(""); setSectionFilter(""); setTagFilter(""); }}>Clear filters</button>}
        </div>

        {/* Advanced filters */}
        <div className="practice-filters" style={{ marginBottom: 0 }}>
          <input className="search" placeholder="Search title, slug, tag, or flag…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="filters">
            {([["", "All"], ["EASY", "Easy"], ["MEDIUM", "Medium"], ["HARD", "Hard"]] as const).map(([v, label]) => (
              <button key={v || "all"} className={difficulty === v ? "active" : ""} onClick={() => setDifficulty(v)}>{label}</button>
            ))}
          </div>
          <select value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)} style={{ width: "auto" }} aria-label="Filter by contest flag">
            <option value="">All flags</option>
            {allFlags.map((fl) => <option key={fl} value={fl}>Flag: {formatProblemFlag(fl)}</option>)}
            <option value="__NONE__">Unflagged</option>
          </select>
          <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value as typeof sectionFilter)} style={{ width: "auto" }} aria-label="Filter by section">
            <option value="">All sections</option>
            <option value="PROBLEM_SET">Problem Set only</option>
            <option value="TD">TD only</option>
            <option value="PUBLIC">Public only</option>
            <option value="HIDDEN">Hidden only</option>
          </select>
          {tags.length > 0 && (
            <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={{ width: "auto" }} aria-label="Filter by topic">
              <option value="">All topics</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: "auto" }} aria-label="Sort problems">
            <option value="newest">Newest first</option>
            <option value="easiest">Easiest first</option>
            <option value="hardest">Hardest first</option>
            <option value="popular">Most solved</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>

        {/* Bulk action bar when 1+ rows selected */}
        {selectedRows.length > 0 && (
          <div className="notice row-between" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
            <div className="row" style={{ gap: "0.45rem" }}>
              <strong>{selectedRows.length} selected</strong>
              <span className="small muted">Flag as:</span>
              <button className="small" disabled={busy} onClick={() => flagProblems(selectedRows.map((p) => p.problem_id), "BASIC")}>Basic</button>
              <button className="small" disabled={busy} onClick={() => flagProblems(selectedRows.map((p) => p.problem_id), "WARMUP")}>Warmup</button>
              <button className="small" disabled={busy} onClick={() => flagProblems(selectedRows.map((p) => p.problem_id), "STANDARD")}>Contest</button>
              <input placeholder="Custom flag…" maxLength={32} value={customFlag} onChange={(e) => setCustomFlag(e.target.value)} style={{ width: 120 }}
                onKeyDown={(e) => { if (e.key === "Enter" && customFlag.trim()) { e.preventDefault(); void flagProblems(selectedRows.map((p) => p.problem_id), customFlag.trim()); setCustomFlag(""); } }} />
              {customFlag.trim() && <button className="small" disabled={busy} onClick={() => { void flagProblems(selectedRows.map((p) => p.problem_id), customFlag.trim()); setCustomFlag(""); }}>Apply</button>}
              <button className="small ghost" disabled={busy} onClick={() => flagProblems(selectedRows.map((p) => p.problem_id), null)}>Clear flag</button>
            </div>
            <div className="row" style={{ gap: "0.5rem" }}>
              <button className="primary small" onClick={launchContestWithSelected}>→ Create contest with {selectedRows.length} selected</button>
              <button className="ghost small" onClick={() => setSelected(new Set())}>Deselect</button>
            </div>
          </div>
        )}

        {published.length === 0 ? <Empty>Nothing published yet.</Empty> : shown.length === 0 ? (
          <Empty>No problem matches these filters. <button className="ghost small" onClick={() => { setQ(""); setDifficulty(""); setFlagFilter(""); setSectionFilter(""); setTagFilter(""); }}>Clear filters</button></Empty>
        ) : (
          <div className="table-wrap"><table className="library-table">
            <thead><tr>
              <th style={{ width: 36 }}><input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} aria-label="Select all shown" /></th>
              <th>Problem</th>
              <th style={{ width: 96 }}>Level</th>
              <th style={{ width: 126 }}>Section</th>
              <th style={{ width: 220 }}>Topics</th>
              <th style={{ width: 170 }} className="right">Actions</th>
            </tr></thead>
            <tbody>{shown.map((p) => {
              const rate = acceptance(p);
              return (
                <tr key={p.problem_id} className={p.hidden ? "hidden-row" : ""}>
                  <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={"Select " + p.title} /></td>
                  <td>
                    <div className="lib-title-row">
                      <strong>{p.title}</strong>
                      {p.contest_flag && <FlagBadge flag={p.contest_flag} />}
                      {p.hidden && <span className="badge neutral">Hidden</span>}
                    </div>
                    <div className="lib-sub-row">
                      <span className="small muted mono">{p.slug}</span>
                      <span className="small muted" title={rate == null ? "" : `Acceptance ${rate}%`}>· {p.solved_by}/{p.tried_by} solved</span>
                    </div>
                  </td>
                  <td><DifficultyPill value={p.difficulty} /></td>
                  <td><select value={p.td_number ?? ""} disabled={busy} style={{ width: "100%", padding: "0.3rem 0.45rem", fontSize: "0.84rem" }} title="Problem Set list, or a TD of the academic section"
                    onChange={(e) => save(p, { td: e.target.value ? Number(e.target.value) : null, tdPosition: p.td_position }, e.target.value ? "Moved to TD " + e.target.value : "Moved to Problem Set")}>
                    <option value="">Problem Set</option>
                    {Array.from({ length: Math.max(12, p.td_number ?? 0) }, (_, i) => <option key={i + 1} value={i + 1}>TD {i + 1}</option>)}
                  </select></td>
                  <td><TagEditor tags={p.tags} suggestions={suggestions} onSave={(next) => save(p, { tags: next }, "Topics saved")} /></td>
                  <td className="right"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap", gap: "0.4rem" }}>
                    {!p.hidden && <a className="btn small ghost" href={(p.td_number ? "#/td/" : "#/problems/") + p.id}>Open</a>}
                    <button className="small" disabled={busy} onClick={() => save(p, { hidden: !p.hidden, reason: p.hidden ? "Shown again" : "Hidden from Problem Set" }, p.hidden ? "Visible in Problem Set again" : "Hidden from Problem Set")}>{p.hidden ? "Show" : "Hide"}</button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <span className="small muted">Flagged problems can be loaded in 1 click inside <strong>New contest</strong>. Topics appear as filters on the public Problem Set page (up to 8 per problem).</span>
      </section>

      <section className="card stack">
        <div className="section-title"><h3>Approved — not in public Problem Set yet</h3><span className="count">{candidates.length}</span></div>
        {candidates.length === 0 ? (
          <Empty>Every approved problem is already in the Problem Set. Create or import more in the Problem lab.</Empty>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Problem</th><th>Difficulty</th><th>Contest flag</th><th>Version</th><th /></tr></thead>
            <tbody>{candidates.map((c) => {
              const replaces = published.find((p) => p.slug === c.slug);
              return (
                <tr key={c.version_id}>
                  <td><strong>{c.title}</strong><div className="small muted mono">{c.slug}</div></td>
                  <td><DifficultyPill value={c.difficulty} /></td>
                  <td>
                    <div className="row" style={{ gap: "0.35rem" }}>
                      <select value={c.contest_flag ?? ""} disabled={busy} style={{ width: "auto" }} aria-label={"Flag for " + c.title}
                        onChange={(e) => flagProblems([c.problem_id ?? c.version_id], e.target.value || null)}>
                        <option value="">— None</option>
                        <option value="BASIC">Basic</option>
                        <option value="WARMUP">Warmup</option>
                        <option value="STANDARD">Contest</option>
                        {c.contest_flag && !["BASIC", "WARMUP", "STANDARD"].includes(c.contest_flag) && <option value={c.contest_flag}>{c.contest_flag}</option>}
                      </select>
                      {c.contest_flag && <FlagBadge flag={c.contest_flag} />}
                    </div>
                  </td>
                  <td className="small">v{c.version_number}{replaces ? <span className="muted"> · replaces the public version</span> : ""}</td>
                  <td className="right"><button className="primary small" disabled={busy}
                    onClick={() => run(async () => { await post("/api/lab/problems/" + c.version_id + "/publish-practice"); data.reload(); }, replaces ? "Problem Set version updated" : "Added to Problem Set")}>
                    {replaces ? "Update public version" : "+ Add to Problem Set"}</button></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
