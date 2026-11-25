import { useEffect, useMemo, useState } from "react";
import { post, put, patch } from "../../api";
import { navigate, useAction, useAuth, useData } from "../../app";
import { Badge, CodeEditor, Empty, ErrorBox, Field, FlagBadge, LANGUAGE_NAMES, Loading, Markdown, ReasonDialog, VERDICTS, formatProblemFlag, queueProblemsForContest, when } from "../../ui";
import { DifficultyPill } from "../Practice";
import { topicLabel } from "../../lib/topics";
import { LanguagePicker } from "../../components/LanguagePicker";
import { SignatureEditor } from "../../components/SignatureEditor";
import { templateFor } from "../../components/Problem";
import { EMPTY_SIGNATURE, FUNCTION_LANGUAGES, describe, parseSignature, type Signature } from "../../lib/functionMode";

const STATUS_TONE: Record<string, string> = { DRAFT: "neutral", IN_TESTING: "info", READY_FOR_REVIEW: "warn", APPROVED: "ok", PUBLISHED: "ok", ARCHIVED: "neutral" };
const DIFF_RANK: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3 };

type LabRow = { id: string; slug: string; version_id: string; title: string; version_number: number; status: string; difficulty?: "EASY" | "MEDIUM" | "HARD"; tags?: string[]; contest_flag?: string | null; folder?: string | null; in_problem_set?: boolean; deleted_at: string | null };

function matchesFolder(problemFolder: string | null | undefined, selected: string) {
  if (!selected) return true;
  if (selected === "__UNFILED__") return !problemFolder;
  if (!problemFolder) return false;
  return problemFolder === selected || problemFolder.startsWith(selected + "/");
}

function buildFolderTree(paths: string[]) {
  const set = new Set<string>();
  for (const p of paths) {
    const segs = p.split("/").filter(Boolean);
    for (let i = 1; i <= segs.length; i++) set.add(segs.slice(0, i).join("/"));
  }
  return [...set].sort((a, b) => a.localeCompare(b)).map((full) => {
    const segs = full.split("/");
    return { full, name: segs[segs.length - 1], depth: segs.length - 1 };
  });
}

export function ProblemList() {
  const { organizer } = useAuth();
  const [showDeleted, setShowDeleted] = useState(false);
  const list = useData<LabRow[]>("/api/lab/problems" + (showDeleted ? "?deleted=true" : ""));
  const [filter, setFilter] = useState("");
  const [difficulty, setDifficulty] = useState<"" | "EASY" | "MEDIUM" | "HARD">("");
  const [flagFilter, setFlagFilter] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [extraFolders, setExtraFolders] = useState<string[]>(["Warmup/Week 1", "Warmup/Week 2", "Basic", "Contests"]);
  const [newFolderInput, setNewFolderInput] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"" | "PRIVATE" | "PUBLIC_SET">("");
  const [statusFilter, setStatusFilter] = useState<"" | "READY_CONTEST" | "REVIEW" | "DRAFT">("");
  const [sort, setSort] = useState<"newest" | "easiest" | "hardest" | "title">("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customFlag, setCustomFlag] = useState("");
  const [target, setTarget] = useState<{ row: LabRow; action: "delete" | "restore" } | null>(null);
  const { busy, run } = useAction();

  const all = list.data ?? [];
  const allFlags = useMemo(() => {
    const custom = new Set<string>();
    for (const p of all) if (p.contest_flag && !["BASIC", "WARMUP", "STANDARD"].includes(p.contest_flag)) custom.add(p.contest_flag);
    return ["BASIC", "WARMUP", "STANDARD", ...[...custom].sort()];
  }, [all]);

  const folderTree = useMemo(() => {
    const paths = [...extraFolders, ...all.map((p) => p.folder).filter((x): x is string => Boolean(x))];
    return buildFolderTree(paths);
  }, [all, extraFolders]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = all.filter((p) => {
      if (q && !(p.title + " " + p.slug + " " + (p.tags ?? []).join(" ") + " " + (p.contest_flag ?? "") + " " + (p.folder ?? "")).toLowerCase().includes(q)) return false;
      if (difficulty && (p.difficulty ?? "MEDIUM") !== difficulty) return false;
      if (flagFilter === "__NONE__" && p.contest_flag) return false;
      if (flagFilter && flagFilter !== "__NONE__" && p.contest_flag !== flagFilter) return false;
      if (!matchesFolder(p.folder, folderFilter)) return false;
      if (scopeFilter === "PRIVATE" && p.in_problem_set) return false;
      if (scopeFilter === "PUBLIC_SET" && !p.in_problem_set) return false;
      if (statusFilter === "READY_CONTEST" && !["APPROVED", "PUBLISHED"].includes(p.status)) return false;
      if (statusFilter === "REVIEW" && p.status !== "READY_FOR_REVIEW") return false;
      if (statusFilter === "DRAFT" && !["DRAFT", "IN_TESTING"].includes(p.status)) return false;
      return true;
    });
    if (sort === "easiest") return [...filtered].sort((a, b) => (DIFF_RANK[a.difficulty ?? "MEDIUM"] ?? 2) - (DIFF_RANK[b.difficulty ?? "MEDIUM"] ?? 2) || a.title.localeCompare(b.title));
    if (sort === "hardest") return [...filtered].sort((a, b) => (DIFF_RANK[b.difficulty ?? "MEDIUM"] ?? 2) - (DIFF_RANK[a.difficulty ?? "MEDIUM"] ?? 2) || a.title.localeCompare(b.title));
    if (sort === "title") return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
    return filtered;
  }, [all, filter, difficulty, flagFilter, folderFilter, scopeFilter, statusFilter, sort]);

  const flagProblems = (ids: string[], flag: string | null) =>
    run(async () => {
      await post("/api/lab/problems/flag", { ids, flag });
      list.reload();
    }, flag ? `Flagged as ${formatProblemFlag(flag)}` : "Flag cleared");

  const moveProblems = (ids: string[], folder: string | null) =>
    run(async () => {
      await post("/api/lab/problems/move", { ids, folder });
      if (folder) setExtraFolders((old) => (old.includes(folder) ? old : [...old, folder]));
      list.reload();
    }, folder ? `Moved to ${folder}` : "Removed from folder");

  const publishSelectedToProblemSet = () =>
    run(async () => {
      for (const p of selectedApproved.filter((x) => !x.in_problem_set)) {
        await post("/api/lab/problems/" + p.version_id + "/publish-practice");
      }
      setSelected(new Set());
      list.reload();
    }, "Published selected problems to Public Problem Set");

  const toggleOne = (versionId: string) => setSelected((old) => {
    const next = new Set(old);
    if (next.has(versionId)) next.delete(versionId);
    else next.add(versionId);
    return next;
  });
  const allShownSelected = rows.length > 0 && rows.every((p) => selected.has(p.version_id));
  const toggleAllShown = () => setSelected((old) => {
    const next = new Set(old);
    if (allShownSelected) rows.forEach((p) => next.delete(p.version_id));
    else rows.forEach((p) => next.add(p.version_id));
    return next;
  });

  const selectedRows = all.filter((p) => selected.has(p.version_id));
  const selectedApproved = selectedRows.filter((p) => p.status === "APPROVED" || p.status === "PUBLISHED");
  const selectedPrivateApproved = selectedApproved.filter((p) => !p.in_problem_set);
  const shownApproved = rows.filter((p) => p.status === "APPROVED" || p.status === "PUBLISHED");
  const hasFilters = Boolean(filter || difficulty || flagFilter || folderFilter || scopeFilter || statusFilter);

  const launchContestFrom = (items: LabRow[]) => {
    if (!items.length) return;
    const uniqueFlags = [...new Set(items.map((p) => p.contest_flag).filter(Boolean))];
    const kind = uniqueFlags.length === 1 && (uniqueFlags[0] === "BASIC" || uniqueFlags[0] === "WARMUP" || uniqueFlags[0] === "STANDARD")
      ? uniqueFlags[0]
      : folderFilter.toLowerCase().startsWith("warmup") ? "WARMUP"
      : folderFilter.toLowerCase().startsWith("basic") ? "BASIC"
      : undefined;
    queueProblemsForContest(items.map((p) => p.version_id), kind);
    navigate("/admin/contests/new");
  };

  const privateCount = all.filter((p) => !p.in_problem_set).length;
  const publicCount = all.filter((p) => p.in_problem_set).length;
  const unfiledCount = all.filter((p) => !p.folder).length;

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Master vault</div><h1>{showDeleted ? "Deleted problems" : "Problem library"}</h1>
          <p>{showDeleted ? "Restore a problem to use it again. Contest history and submissions were never removed."
            : "Organize all your problems in nested folders (Warmup/Week 1, Basic, Contests…), move problems in bulk, and launch contests from any folder."}</p></div>
        <div className="row">
          <button className="ghost" onClick={() => { setShowDeleted(!showDeleted); setSelected(new Set()); }}>{showDeleted ? "← Back to library" : "🗑 Show deleted"}</button>
          {!showDeleted && <><button onClick={() => navigate("/admin/problems/import")}>Bulk import</button><button className="primary" onClick={() => navigate("/admin/problems/new")}>+ New problem</button></>}
        </div>
      </div>

      {!showDeleted && (
        <section className="card folder-shelf" aria-label="Library folders">
          <div className="row-between" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
            <div className="folder-shelf-row">
              <button type="button" className={"folder-chip" + (folderFilter === "" && scopeFilter === "" ? " active" : "")}
                onClick={() => { setFolderFilter(""); setScopeFilter(""); }}>
                <span>📚 All library</span><span className="fcount">{all.length}</span>
              </button>
              <button type="button" className={"folder-chip" + (scopeFilter === "PUBLIC_SET" ? " active" : "")}
                onClick={() => { setFolderFilter(""); setScopeFilter("PUBLIC_SET"); }}>
                <span>★ Public Problem Set</span><span className="fcount">{publicCount}</span>
              </button>
              <button type="button" className={"folder-chip" + (scopeFilter === "PRIVATE" && folderFilter === "" ? " active" : "")}
                onClick={() => { setFolderFilter(""); setScopeFilter("PRIVATE"); }}>
                <span>🔒 Private / Contests</span><span className="fcount">{privateCount}</span>
              </button>
              <button type="button" className={"folder-chip" + (folderFilter === "__UNFILED__" ? " active" : "")}
                onClick={() => { setFolderFilter("__UNFILED__"); setScopeFilter(""); }}>
                <span>○ Unfiled</span><span className="fcount">{unfiledCount}</span>
              </button>
            </div>
            {organizer && (
              <form className="row" style={{ gap: "0.35rem", flexWrap: "nowrap" }} onSubmit={(e) => {
                e.preventDefault();
                const clean = newFolderInput.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
                if (!clean) return;
                setExtraFolders((old) => (old.includes(clean) ? old : [...old, clean]));
                setFolderFilter(clean);
                setScopeFilter("");
                setNewFolderInput("");
              }}>
                <input placeholder="+ New folder (e.g. Warmup/Week 3)" value={newFolderInput} onChange={(e) => setNewFolderInput(e.target.value)} style={{ width: 220, padding: "0.32rem 0.6rem", fontSize: "0.84rem" }} />
                <button className="small" type="submit" disabled={!newFolderInput.trim()}>Add</button>
              </form>
            )}
          </div>

          <div className="folder-shelf-row">
            <span className="small muted" style={{ marginRight: "0.2rem" }}>Folders:</span>
            {folderTree.map((node) => {
              const count = all.filter((p) => matchesFolder(p.folder, node.full)).length;
              return (
                <button key={node.full} type="button"
                  className={"folder-chip" + (node.depth > 0 ? " sub" : "") + (folderFilter === node.full ? " active" : "")}
                  onClick={() => { setFolderFilter(folderFilter === node.full ? "" : node.full); setScopeFilter(""); }}>
                  <span>📁 {node.full}</span>
                  <span className="fcount">{count}</span>
                </button>
              );
            })}
            {organizer && folderFilter && folderFilter !== "__UNFILED__" && shownApproved.length > 0 && (
              <button type="button" className="primary small" style={{ marginLeft: "auto" }} onClick={() => launchContestFrom(shownApproved)}>
                → Create contest from “{folderFilter}” ({shownApproved.length})
              </button>
            )}
          </div>
        </section>
      )}

      <div className="practice-filters" style={{ marginBottom: 0 }}>
        <input className="search" placeholder="Search title, slug, topic, flag, or folder…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="filters">
          {([["", "All"], ["EASY", "Easy"], ["MEDIUM", "Medium"], ["HARD", "Hard"]] as const).map(([v, label]) => (
            <button key={v || "all"} className={difficulty === v ? "active" : ""} onClick={() => setDifficulty(v)}>{label}</button>
          ))}
        </div>
        {!showDeleted && (
          <>
            <select value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)} style={{ width: "auto" }} aria-label="Filter by contest flag">
              <option value="">All flags</option>
              {allFlags.map((fl) => <option key={fl} value={fl}>Flag: {formatProblemFlag(fl)}</option>)}
              <option value="__NONE__">Unflagged</option>
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} style={{ width: "auto" }} aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="READY_CONTEST">Contest-ready</option>
              <option value="REVIEW">Ready for review</option>
              <option value="DRAFT">Draft / Testing</option>
            </select>
          </>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: "auto" }} aria-label="Sort problems">
          <option value="newest">Newest first</option>
          <option value="easiest">Easiest first</option>
          <option value="hardest">Hardest first</option>
          <option value="title">Title A–Z</option>
        </select>
        {hasFilters && <button className="ghost small" onClick={() => { setFilter(""); setDifficulty(""); setFlagFilter(""); setFolderFilter(""); setScopeFilter(""); setStatusFilter(""); }}>Clear</button>}
      </div>

      {!showDeleted && organizer && selectedRows.length > 0 && (
        <div className="notice stack" style={{ gap: "0.6rem" }}>
          <div className="row-between" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
            <div className="row" style={{ gap: "0.45rem" }}>
              <strong>{selectedRows.length} selected</strong>
              <span className="small muted">📁 Move to:</span>
              <input list="library-move-folders" placeholder="e.g. Warmup/Week 1" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} style={{ width: 180 }} />
              <datalist id="library-move-folders">{folderTree.map((n) => <option key={n.full} value={n.full} />)}</datalist>
              <button className="small primary" disabled={busy || !moveTarget.trim()} onClick={() => { void moveProblems(selectedRows.map((p) => p.id), moveTarget.trim()); setMoveTarget(""); }}>Move</button>
              <button className="small ghost" disabled={busy} onClick={() => moveProblems(selectedRows.map((p) => p.id), null)}>Unfile</button>
            </div>
            <div className="row" style={{ gap: "0.5rem" }}>
              {selectedPrivateApproved.length > 0 && (
                <button className="small" disabled={busy} onClick={publishSelectedToProblemSet}>
                  + Publish {selectedPrivateApproved.length} to Problem Set
                </button>
              )}
              <button className="primary small" disabled={selectedApproved.length === 0} onClick={() => launchContestFrom(selectedApproved)}>
                → Create contest ({selectedApproved.length})
              </button>
              <button className="ghost small" onClick={() => setSelected(new Set())}>Deselect</button>
            </div>
          </div>
          <div className="row" style={{ gap: "0.45rem" }}>
            <span className="small muted">Flag as:</span>
            <button className="small" disabled={busy} onClick={() => flagProblems(selectedRows.map((p) => p.id), "BASIC")}>Basic</button>
            <button className="small" disabled={busy} onClick={() => flagProblems(selectedRows.map((p) => p.id), "WARMUP")}>Warmup</button>
            <button className="small" disabled={busy} onClick={() => flagProblems(selectedRows.map((p) => p.id), "STANDARD")}>Contest</button>
            <input placeholder="Custom flag…" maxLength={32} value={customFlag} onChange={(e) => setCustomFlag(e.target.value)} style={{ width: 120 }}
              onKeyDown={(e) => { if (e.key === "Enter" && customFlag.trim()) { e.preventDefault(); void flagProblems(selectedRows.map((p) => p.id), customFlag.trim()); setCustomFlag(""); } }} />
            {customFlag.trim() && <button className="small" disabled={busy} onClick={() => { void flagProblems(selectedRows.map((p) => p.id), customFlag.trim()); setCustomFlag(""); }}>Apply</button>}
            <button className="small ghost" disabled={busy} onClick={() => flagProblems(selectedRows.map((p) => p.id), null)}>Clear flag</button>
          </div>
        </div>
      )}

      <ErrorBox error={list.error} />
      {list.loading ? <Loading /> : !rows.length ? <Empty>{showDeleted ? "No deleted problems." : hasFilters ? "No problem in this folder / filter yet." : "No problems yet."}</Empty> : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="library-table">
            <thead><tr>
              {!showDeleted && organizer && <th style={{ width: 38 }}><input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} aria-label="Select all shown" /></th>}
              <th>Problem</th>
              <th style={{ width: 110 }}>Difficulty</th>
              {!showDeleted && <th style={{ width: 130 }}>Visibility</th>}
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 140 }} className="right">Actions</th>
            </tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.version_id} onClick={() => !showDeleted && organizer && toggleOne(p.version_id)} style={{ cursor: !showDeleted && organizer ? "pointer" : "default" }}>
                {!showDeleted && organizer && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(p.version_id)} onChange={() => toggleOne(p.version_id)} aria-label={"Select " + p.title} />
                  </td>
                )}
                <td>
                  <div className="lib-title-row">
                    <strong>{p.title}</strong>
                    {p.folder && <span className="tag" style={{ fontSize: "0.75rem" }}>📁 {p.folder}</span>}
                    {p.contest_flag && <FlagBadge flag={p.contest_flag} />}
                  </div>
                  <div className="lib-sub-row">
                    <span className="small muted mono">{p.slug} · v{p.version_number}</span>
                    {(p.tags?.length ?? 0) > 0 && p.tags!.map((t) => <span key={t} className="tag-chip small">{topicLabel(t)}</span>)}
                  </div>
                </td>
                <td><DifficultyPill value={p.difficulty ?? "MEDIUM"} /></td>
                {!showDeleted && (
                  <td>{p.in_problem_set ? <Badge tone="ok">Public Set</Badge> : <Badge tone="neutral">Private</Badge>}</td>
                )}
                <td>{showDeleted ? <Badge>Deleted {p.deleted_at ? when(p.deleted_at) : ""}</Badge> : <Badge tone={STATUS_TONE[p.status]}>{p.status.replace(/_/g, " ")}</Badge>}</td>
                <td className="right" onClick={(e) => e.stopPropagation()}>
                  <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap", gap: "0.4rem" }}>
                    {showDeleted ? <button className="small primary" onClick={() => setTarget({ row: p, action: "restore" })}>Restore</button> : <>
                      <a className="btn small" href={"#/admin/problems/" + p.version_id}>Open</a>
                      <button className="small danger" onClick={() => setTarget({ row: p, action: "delete" })} title="Delete this problem">Delete</button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <span className="small muted">Showing {rows.length} of {all.length} problems. Click any row (or checkbox) to select problems for moving to a folder, flagging, publishing, or creating a contest.</span>
      {target && (
        <ReasonDialog title={(target.action === "delete" ? "Delete “" : "Restore “") + target.row.title + "”"} confirm={target.action === "delete" ? "Delete problem" : "Restore"}
          danger={target.action === "delete"} onClose={() => setTarget(null)}
          description={target.action === "delete"
            ? "The problem (all its versions) leaves the Problem lab, the contest wizard and Problem Set. Finished contests, scoreboards and submissions keep it, so nothing breaks. You can restore it later from “Show deleted”. A problem used by a contest that has not finished cannot be deleted."
            : "The problem comes back to the Problem lab. If it was in Problem Set, show it again from the Problem Set page."}
          onSubmit={(reason) => run(async () => { await post("/api/lab/problems/" + target.row.version_id + "/" + target.action, { reason }); setTarget(null); list.reload(); },
            target.action === "delete" ? "Problem deleted" : "Problem restored")} />
      )}
    </div>
  );
}

type Version = {
  id: string; problem_id: string; title: string; status: string; version_number: number; sealed_at: string | null; difficulty: string; checker: string;
  statement_md: string; input_format_md: string; output_format_md: string; constraints_md: string; explanation_md: string; setter_notes: string;
  time_limit_ms: number; memory_limit_mb: number; output_limit_kb: number; function_signature: string | null;
  tests: { id: string; input_data: string; expected_output: string; is_sample: boolean }[];
  references: { id: string; label: string; language_code: string; expected_verdict: string; source_code: string }[];
  validations: { id: string; status: string; report: string; created_at: string; completed_at: string | null }[];
  languages: string[];
};

export function ProblemEditor({ versionId }: { versionId: string }) {
  const v = useData<Version>("/api/lab/problems/" + versionId, 0);
  const [tab, setTab] = useState<"statement" | "tests" | "references" | "validation">("statement");
  const { busy, run } = useAction();
  const [approving, setApproving] = useState(false);
  const validating = v.data?.validations[0]?.status === "PENDING" || v.data?.validations[0]?.status === "RUNNING";
  const reload = v.reload;
  useEffect(() => {
    if (!validating) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [validating, reload]);
  if (v.loading) return <Loading />;
  if (!v.data) return <ErrorBox error={v.error} />;
  const p = v.data, sealed = Boolean(p.sealed_at);
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <a href="#/admin/problems" className="small">← Problems</a>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>{p.title} <span className="muted">v{p.version_number}</span></h1>
          <div className="row"><Badge tone={STATUS_TONE[p.status]}>{p.status.replace(/_/g, " ")}</Badge>{sealed && <Badge>Sealed (immutable)</Badge>}<span className="small muted mono">{p.id}</span></div></div>
        <div className="row">
          {sealed && <button disabled={busy} onClick={() => run(async () => { const r = await post("/api/lab/problems/" + p.id + "/clone"); navigate("/admin/problems/" + r.versionId); }, "New editable version created")}>Clone to edit</button>}
          {!sealed && <button className="primary" disabled={busy} onClick={() => run(async () => { await post("/api/lab/problems/" + p.id + "/validate"); setTab("validation"); await v.reload(); }, "Validation queued on the internal judge lane")}>Seal & validate</button>}
          {p.status === "READY_FOR_REVIEW" && <button className="primary" onClick={() => setApproving(true)}>Approve…</button>}
          {p.status === "APPROVED" && <button disabled={busy} onClick={() => run(async () => { await post("/api/lab/problems/" + p.id + "/publish-practice"); await v.reload(); }, "Published to Problem Set")}>Publish to Problem Set</button>}
        </div>
      </div>
      <div className="tabs">
        {(["statement", "tests", "references", "validation"] as const).map((t) => <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === "statement" && <StatementForm p={p} sealed={sealed} onSaved={v.reload} />}
      {tab === "tests" && <TestsForm p={p} sealed={sealed} onSaved={v.reload} />}
      {tab === "references" && <References p={p} sealed={sealed} onSaved={v.reload} />}
      {tab === "validation" && (
        <div className="stack">
          {p.validations.length === 0 ? <Empty>Not validated yet. Validation runs every reference solution against every test in the real sandbox.</Empty> : p.validations.map((r) => (
            <div key={r.id} className="card">
              <div className="row-between"><Badge tone={r.status === "PASSED" ? "ok" : r.status === "FAILED" || r.status === "JUDGE_ERROR" ? "bad" : "info"}>{r.status}</Badge><span className="small muted">{when(r.created_at)}</span></div>
              {r.report && r.report !== "{}" && <pre className="card-flat small" style={{ marginTop: "0.75rem" }}>{JSON.stringify(JSON.parse(r.report), null, 2)}</pre>}
            </div>
          ))}
        </div>
      )}
      {approving && <ReasonDialog title="Approve problem version" confirm="Approve" onClose={() => setApproving(false)}
        onSubmit={(reason) => run(async () => { await post("/api/lab/problems/" + p.id + "/approve", { reason }); setApproving(false); await v.reload(); }, "Approved")} />}
    </div>
  );
}

function StatementForm({ p, sealed, onSaved }: { p: Version; sealed: boolean; onSaved: () => void }) {
  const [f, setF] = useState({
    title: p.title, statement: p.statement_md, inputFormat: p.input_format_md, outputFormat: p.output_format_md, constraints: p.constraints_md,
    explanation: p.explanation_md, setterNotes: p.setter_notes, difficulty: p.difficulty, checker: p.checker,
    timeLimitMs: p.time_limit_ms, memoryLimitMb: p.memory_limit_mb, outputLimitKb: p.output_limit_kb, languages: p.languages,
    functionSignature: parseSignature(p.function_signature),
  });
  const signature = f.functionSignature;
  const setSignature = (next: Signature | null) =>
    setF({ ...f, functionSignature: next, languages: next ? f.languages.filter((l) => FUNCTION_LANGUAGES.includes(l)) : f.languages });
  const [preview, setPreview] = useState(false);
  const { busy, run } = useAction();
  const text = (key: keyof typeof f, label: string, rows = 4) => (
    <Field label={label}><textarea rows={rows} disabled={sealed} value={f[key] as string} onChange={(e) => setF({ ...f, [key]: e.target.value })} /></Field>
  );
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await patch("/api/lab/problems/" + p.id, f); onSaved(); }, "Saved"); }}>
        <Field label="Title"><input disabled={sealed} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        {text("statement", "Statement (Markdown)", 10)}
        <Field label="How contestants answer" hint="A function works like LeetCode: contestants complete one function and never read input.">
          <select disabled={sealed} value={signature ? "FUNCTION" : "STDIO"} onChange={(e) => setSignature(e.target.value === "FUNCTION" ? EMPTY_SIGNATURE : null)}>
            <option value="STDIO">Full program (standard input and output)</option><option value="FUNCTION">Complete a function (LeetCode style)</option></select></Field>
        {signature && <SignatureEditor value={signature} onChange={setSignature} disabled={sealed} />}
        {!signature && text("inputFormat", "Input format")}
        {!signature && text("outputFormat", "Output format")}
        {text("constraints", "Constraints", 3)}
        {text("explanation", "Notes / explanation", 3)}
        {text("setterNotes", "Private setter notes (never shown to contestants)", 3)}
        <div className="grid grid-3">
          <Field label="Time limit (ms)"><input type="number" min={1} max={60000} disabled={sealed} value={f.timeLimitMs} onChange={(e) => setF({ ...f, timeLimitMs: Number(e.target.value) })} /></Field>
          <Field label="Memory (MB)" hint="Must fit the worker slot memory."><input type="number" min={16} max={4096} disabled={sealed} value={f.memoryLimitMb} onChange={(e) => setF({ ...f, memoryLimitMb: Number(e.target.value) })} /></Field>
          <Field label="Output (KB)"><input type="number" min={1} max={65536} disabled={sealed} value={f.outputLimitKb} onChange={(e) => setF({ ...f, outputLimitKb: Number(e.target.value) })} /></Field>
          <Field label="Checker" hint={signature ? "Not used: function results are compared as values." : undefined}><select disabled={sealed || Boolean(signature)} value={f.checker} onChange={(e) => setF({ ...f, checker: e.target.value })}>
            <option value="TRIMMED_LINES">Trimmed lines</option><option value="TOKENS">Tokens</option><option value="EXACT">Exact</option></select></Field>
          <Field label="Difficulty"><select disabled={sealed} value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>
            <option>EASY</option><option>MEDIUM</option><option>HARD</option></select></Field>
        </div>
        <Field label="Languages">
          <LanguagePicker disabled={sealed} value={f.languages} onChange={(languages) => setF({ ...f, languages })} allowed={signature ? FUNCTION_LANGUAGES : undefined} />
        </Field>
        {!sealed && <div><button className="primary" disabled={busy}>Save draft</button></div>}
      </form>
      <div className="card">
        <div className="row-between"><h3>Contestant preview</h3><button className="small" onClick={() => setPreview(!preview)}>{preview ? "Hide" : "Show"}</button></div>
        {preview && signature && <><h1>{f.title}</h1><Markdown text={f.statement} /><h2>Function</h2><pre>{describe(signature)}</pre></>}
        {preview && !signature && <><h1>{f.title}</h1><Markdown text={f.statement} /><h2>Input</h2><Markdown text={f.inputFormat} /><h2>Output</h2><Markdown text={f.outputFormat} /></>}
      </div>
    </div>
  );
}

function TestsForm({ p, sealed, onSaved }: { p: Version; sealed: boolean; onSaved: () => void }) {
  const [tests, setTests] = useState(p.tests.map((t) => ({ input: t.input_data, expected: t.expected_output, sample: t.is_sample })));
  const { busy, run } = useAction();
  const update = (i: number, change: Partial<(typeof tests)[number]>) => setTests(tests.map((t, j) => (i === j ? { ...t, ...change } : t)));
  return (
    <div className="stack">
      <div className="notice small">Tests replace the whole suite (1-200 tests, 16 MiB total). Mark at least one sample (shown in the statement) and keep at least one hidden test.
        {p.function_signature && " Function problem: each input has one JSON value per parameter line, and the expected output is the return value as JSON."}</div>
      {tests.map((t, i) => (
        <div key={i} className="card stack">
          <div className="row-between"><strong>Test {i + 1}</strong>
            <div className="row"><label className="check small"><input type="checkbox" disabled={sealed} checked={t.sample} onChange={(e) => update(i, { sample: e.target.checked })} />Sample</label>
              {!sealed && <button className="small danger" onClick={() => setTests(tests.filter((_, j) => j !== i))}>Remove</button>}</div></div>
          <div className="grid grid-2">
            <Field label="Input"><textarea className="mono" rows={4} disabled={sealed} value={t.input} onChange={(e) => update(i, { input: e.target.value })} /></Field>
            <Field label="Expected output"><textarea className="mono" rows={4} disabled={sealed} value={t.expected} onChange={(e) => update(i, { expected: e.target.value })} /></Field>
          </div>
        </div>
      ))}
      {!sealed && (
        <div className="row">
          <button onClick={() => setTests([...tests, { input: "", expected: "", sample: tests.length === 0 }])}>Add test</button>
          <button className="primary" disabled={busy || tests.length === 0} onClick={() => run(async () => { await put("/api/lab/problems/" + p.id + "/tests", tests); onSaved(); }, "Test suite saved")}>Save suite</button>
        </div>
      )}
    </div>
  );
}

function References({ p, sealed, onSaved }: { p: Version; sealed: boolean; onSaved: () => void }) {
  const signature = parseSignature(p.function_signature);
  const [form, setForm] = useState(() => ({ label: "Main solution", language: p.languages[0] ?? "CPP", expectedVerdict: "ACCEPTED", sourceCode: signature ? templateFor(p.languages[0] ?? "CPP", signature) : "" }));
  const { busy, run } = useAction();
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="stack">
        {p.references.length === 0 ? <Empty>Add at least one reference expected to be accepted.</Empty> : p.references.map((r) => (
          <div key={r.id} className="card stack">
            <div className="row-between"><strong>{r.label}</strong><div className="row"><Badge>{LANGUAGE_NAMES[r.language_code]}</Badge><Badge tone={VERDICTS[r.expected_verdict]?.tone}>expects {VERDICTS[r.expected_verdict]?.short}</Badge></div></div>
            <pre className="card-flat small mono" style={{ maxHeight: 200, overflow: "auto" }}>{r.source_code}</pre>
          </div>
        ))}
      </div>
      {!sealed && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await post("/api/lab/problems/" + p.id + "/references", form); setForm({ ...form, sourceCode: "" }); onSaved(); }, "Reference added"); }}>
          <h3>Add reference solution</h3>
          <div className="grid grid-3">
            <Field label="Label"><input required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
            <Field label="Language"><select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value, sourceCode: signature && (!form.sourceCode.trim() || form.sourceCode === templateFor(form.language, signature)) ? templateFor(e.target.value, signature) : form.sourceCode })}>{p.languages.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}</select></Field>
            <Field label="Expected verdict"><select value={form.expectedVerdict} onChange={(e) => setForm({ ...form, expectedVerdict: e.target.value })}>
              {Object.entries(VERDICTS).filter(([k]) => k !== "JUDGE_ERROR").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          </div>
          <div style={{ height: 320, display: "flex" }}><CodeEditor value={form.sourceCode} onChange={(s) => setForm({ ...form, sourceCode: s })} language={form.language} /></div>
          <div><button className="primary" disabled={busy || !form.sourceCode.trim()}>Add reference</button></div>
        </form>
      )}
    </div>
  );
}
