import { useEffect, useMemo, useState } from "react";
import { patch, post, put } from "../../api";
import { navigate, useAction, useAuth, useData, useRoute } from "../../app";
import { AdminIcon } from "../../components/AdminIcons";
import { LanguagePicker } from "../../components/LanguagePicker";
import { templateFor } from "../../components/Problem";
import { SignatureEditor } from "../../components/SignatureEditor";
import { EMPTY_SIGNATURE, FUNCTION_LANGUAGES, describe, parseSignature, type Signature } from "../../lib/functionMode";
import { topicLabel } from "../../lib/topics";
import {
  Badge,
  CodeEditor,
  Empty,
  ErrorBox,
  Field,
  LANGUAGE_NAMES,
  Loading,
  Markdown,
  ReasonDialog,
  VERDICTS,
  when,
} from "../../ui";
import { DifficultyPill } from "../Practice";
import {
  AssignModal,
  BulkTagsModal,
  CollectionsModal,
  ProblemPreviewModal,
  isUnassigned,
  type AssignSurface,
  type BankRow,
} from "./ProblemModals";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "neutral",
  IN_TESTING: "info",
  READY_FOR_REVIEW: "warn",
  APPROVED: "ok",
  PUBLISHED: "ok",
  ARCHIVED: "neutral",
};

const DIFF_RANK: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3 };

type ScopeView =
  | "ALL"
  | "PRIVATE"
  | "PRACTICE"
  | "TD"
  | "MISSION"
  | "DUEL"
  | "CONTEST"
  | "REVIEW"
  | "DELETED";

function matchesCollection(problemFolder: string | null | undefined, selected: string) {
  if (!selected) return true;
  if (selected === "__UNCOLLECTED__") return !problemFolder;
  if (!problemFolder) return false;
  return problemFolder === selected || problemFolder.startsWith(selected + "/");
}

function statusBadge(row: BankRow) {
  if (row.deleted_at) return <span className="state-ind neutral">Deleted</span>;
  if (row.validation_status === "FAILED" || row.validation_status === "JUDGE_ERROR") {
    return <span className="state-ind bad">Failed</span>;
  }
  if (row.status === "APPROVED" || row.status === "PUBLISHED") return <span className="state-ind ok">Ready</span>;
  if (row.status === "READY_FOR_REVIEW") return <span className="state-ind warn">Review</span>;
  if (row.status === "IN_TESTING") return <span className="state-ind info">Testing</span>;
  return <span className="state-ind neutral">Draft</span>;
}

function PlacementPills({ row }: { row: BankRow }) {
  const pills: { key: string; cls: string; text: string; tip?: string }[] = [];
  if (row.in_problem_set) pills.push({ key: "prac", cls: "practice", text: "Practice", tip: "Public Practice Set" });
  if (row.td_number != null) pills.push({ key: "td", cls: "td", text: `TD ${row.td_number}`, tip: `Academic TD ${row.td_number}` });
  if (row.mission_slug) {
    pills.push({
      key: "mis",
      cls: "mission",
      text: `TP: ${row.mission_title || row.mission_slug}`,
      tip: `Mission: ${row.mission_title || row.mission_slug}`,
    });
  }
  if (row.in_duel_pool) pills.push({ key: "duel", cls: "duel", text: "Duels", tip: "Private Duel Pool" });
  if ((row.contest_count ?? 0) > 0) {
    pills.push({
      key: "con",
      cls: "contest",
      text: row.contest_count === 1 ? "1 Contest" : `${row.contest_count} Contests`,
      tip: row.contest_titles ? `Contests: ${row.contest_titles}` : undefined,
    });
  }

  if (pills.length === 0) {
    return (
      <span className="surface-unassigned" title="Private in Problem Bank — not visible to students">
        Private
      </span>
    );
  }

  const fullTip = pills.map((p) => p.tip || p.text).join(" · ");
  const shown = pills.slice(0, 2);
  const overflow = pills.length - shown.length;

  return (
    <div className="surface-pills" title={fullTip}>
      {shown.map((p) => (
        <span key={p.key} className={"surface-pill " + p.cls}>
          {p.text}
        </span>
      ))}
      {overflow > 0 && <span className="surface-pill">+{overflow}</span>}
    </div>
  );
}

export function ProblemList() {
  const { organizer } = useAuth();
  const { query } = useRoute();
  const initialCollection = query.get("collection") ?? "";

  const [scope, setScope] = useState<ScopeView>("ALL");
  const showDeleted = scope === "DELETED";

  const list = useData<BankRow[]>("/api/lab/problems" + (showDeleted ? "?deleted=true" : ""));
  const collectionsData = useData<{ collections: { name: string; problem_count: number }[] }>("/api/lab/problems/collections");

  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<"" | "EASY" | "MEDIUM" | "HARD">("");
  const [collectionFilter, setCollectionFilter] = useState(initialCollection);
  const [statusFilter, setStatusFilter] = useState<"" | "READY" | "REVIEW" | "DRAFT">("");
  const [sort, setSort] = useState<"newest" | "easiest" | "hardest" | "title">("newest");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignState, setAssignState] = useState<{ rows: BankRow[]; surface?: AssignSurface } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [tagsTarget, setTagsTarget] = useState<BankRow[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ row: BankRow; action: "delete" | "restore" } | null>(null);

  const { busy, run } = useAction();

  useEffect(() => {
    const param = query.get("collection");
    if (param !== null) setCollectionFilter(param);
  }, [query]);

  const all = list.data ?? [];
  const collections = collectionsData.data?.collections ?? [];

  const counts = useMemo(() => {
    if (showDeleted) {
      return { all: 0, priv: 0, practice: 0, td: 0, mission: 0, duel: 0, contest: 0, review: 0, uncollected: 0 };
    }
    return {
      all: all.length,
      priv: all.filter(isUnassigned).length,
      practice: all.filter((p) => p.in_problem_set).length,
      td: all.filter((p) => p.td_number != null).length,
      mission: all.filter((p) => Boolean(p.mission_slug)).length,
      duel: all.filter((p) => p.in_duel_pool).length,
      contest: all.filter((p) => (p.contest_count ?? 0) > 0).length,
      review: all.filter((p) => p.status === "READY_FOR_REVIEW").length,
      uncollected: all.filter((p) => !p.folder).length,
    };
  }, [all, showDeleted]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = all.filter((p) => {
      if (!showDeleted) {
        if (scope === "PRIVATE" && !isUnassigned(p)) return false;
        if (scope === "PRACTICE" && !p.in_problem_set) return false;
        if (scope === "TD" && p.td_number == null) return false;
        if (scope === "MISSION" && !p.mission_slug) return false;
        if (scope === "DUEL" && !p.in_duel_pool) return false;
        if (scope === "CONTEST" && !(p.contest_count && p.contest_count > 0)) return false;
        if (scope === "REVIEW" && p.status !== "READY_FOR_REVIEW") return false;
        if (!matchesCollection(p.folder, collectionFilter)) return false;
        if (statusFilter === "READY" && !["APPROVED", "PUBLISHED"].includes(p.status)) return false;
        if (statusFilter === "REVIEW" && p.status !== "READY_FOR_REVIEW") return false;
        if (statusFilter === "DRAFT" && !["DRAFT", "IN_TESTING"].includes(p.status)) return false;
      }
      if (difficulty && (p.difficulty ?? "MEDIUM") !== difficulty) return false;
      if (q) {
        const hay = [
          p.title,
          p.slug,
          p.folder ?? "",
          p.mission_title ?? "",
          p.contest_titles ?? "",
          ...(p.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sort === "easiest") {
      return [...filtered].sort(
        (a, b) =>
          (DIFF_RANK[a.difficulty ?? "MEDIUM"] ?? 2) - (DIFF_RANK[b.difficulty ?? "MEDIUM"] ?? 2) ||
          a.title.localeCompare(b.title),
      );
    }
    if (sort === "hardest") {
      return [...filtered].sort(
        (a, b) =>
          (DIFF_RANK[b.difficulty ?? "MEDIUM"] ?? 2) - (DIFF_RANK[a.difficulty ?? "MEDIUM"] ?? 2) ||
          a.title.localeCompare(b.title),
      );
    }
    if (sort === "title") return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
    return filtered;
  }, [all, showDeleted, scope, collectionFilter, statusFilter, difficulty, search, sort]);

  const toggleOne = (versionId: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(versionId)) next.delete(versionId);
      else next.add(versionId);
      return next;
    });

  const allShownSelected = rows.length > 0 && rows.every((p) => selected.has(p.version_id));
  const toggleAllShown = () =>
    setSelected((old) => {
      const next = new Set(old);
      if (allShownSelected) rows.forEach((p) => next.delete(p.version_id));
      else rows.forEach((p) => next.add(p.version_id));
      return next;
    });

  const selectedRows = useMemo(() => all.filter((p) => selected.has(p.version_id)), [all, selected]);
  const selectedReviewReady = useMemo(
    () => selectedRows.filter((p) => p.status === "READY_FOR_REVIEW" && p.validation_status === "PASSED"),
    [selectedRows],
  );

  const reloadAll = () => {
    void list.reload();
    void collectionsData.reload();
  };

  const approveSelected = () =>
    run(async () => {
      await post("/api/lab/problems/bulk-approve", {
        versionIds: selectedReviewReady.map((p) => p.version_id),
        reason: "Approved from Problem Bank",
      });
      setSelected(new Set());
      reloadAll();
    }, `Approved ${selectedReviewReady.length} problem${selectedReviewReady.length === 1 ? "" : "s"}`);

  const hasFilters = Boolean(search || difficulty || collectionFilter || statusFilter || (scope !== "ALL" && scope !== "DELETED"));

  const switchScope = (next: ScopeView) => {
    setScope(next);
    setSelected(new Set());
  };

  const tabs: { key: ScopeView; label: string; count?: number }[] = [
    { key: "ALL", label: "All", count: showDeleted ? undefined : counts.all },
    { key: "PRIVATE", label: "Private", count: showDeleted ? undefined : counts.priv },
    { key: "PRACTICE", label: "Practice", count: showDeleted ? undefined : counts.practice },
    { key: "TD", label: "TDs", count: showDeleted ? undefined : counts.td },
    { key: "MISSION", label: "Missions", count: showDeleted ? undefined : counts.mission },
    { key: "DUEL", label: "Duel Pool", count: showDeleted ? undefined : counts.duel },
    { key: "CONTEST", label: "In Contests", count: showDeleted ? undefined : counts.contest },
    { key: "REVIEW", label: "Needs Review", count: showDeleted ? undefined : counts.review },
    { key: "DELETED", label: "Deleted" },
  ];

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Build</div>
          <h1>Problem Bank</h1>
          <p>
            One central vault for every problem. Import privately, organize into collections, and assign to Practice, TDs, Missions, Duels, or Contests.
          </p>
        </div>
        <div className="row" style={{ gap: "0.5rem" }}>
          <button onClick={() => navigate("/admin/problems/import")}>
            <AdminIcon name="upload" /> Bulk import
          </button>
          <button className="primary" onClick={() => navigate("/admin/problems/new")}>
            <AdminIcon name="plus" /> New problem
          </button>
        </div>
      </div>

      <div className="scope-tabs" role="tablist" aria-label="Problem views">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={scope === t.key}
            className={"scope-tab" + (scope === t.key ? " active" : "")}
            onClick={() => switchScope(t.key)}
          >
            {t.label}
            {t.count !== undefined && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="admin-toolbar">
        <input
          className="toolbar-search"
          placeholder="Search problems…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {!showDeleted && (
          <>
            <select
              value={collectionFilter}
              onChange={(e) => setCollectionFilter(e.target.value)}
              aria-label="Filter by collection"
            >
              <option value="">All collections</option>
              <option value="__UNCOLLECTED__">Uncollected ({counts.uncollected})</option>
              {collections.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.problem_count})
                </option>
              ))}
            </select>
            {organizer && (
              <button type="button" onClick={() => setCollectionsOpen(true)} title="Create, rename, or delete collections">
                <AdminIcon name="folder" /> Collections
              </button>
            )}
          </>
        )}

        <div className="seg-group" role="group" aria-label="Difficulty filter">
          {([
            ["", "All"],
            ["EASY", "Easy"],
            ["MEDIUM", "Med"],
            ["HARD", "Hard"],
          ] as const).map(([val, lbl]) => (
            <button
              key={val || "all"}
              type="button"
              className={difficulty === val ? "active" : ""}
              onClick={() => setDifficulty(val)}
            >
              {lbl}
            </button>
          ))}
        </div>

        {!showDeleted && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            aria-label="Filter by readiness"
          >
            <option value="">All states</option>
            <option value="READY">Ready to assign</option>
            <option value="REVIEW">Needs review</option>
            <option value="DRAFT">Draft / Testing</option>
          </select>
        )}

        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort order">
          <option value="newest">Newest first</option>
          <option value="easiest">Easiest first</option>
          <option value="hardest">Hardest first</option>
          <option value="title">Title A–Z</option>
        </select>

        {hasFilters && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setSearch("");
              setDifficulty("");
              setCollectionFilter("");
              setStatusFilter("");
              if (scope !== "DELETED") setScope("ALL");
            }}
          >
            Reset
          </button>
        )}
      </div>

      {!showDeleted && collectionFilter && collectionFilter !== "__UNCOLLECTED__" && (
        <div className="collection-bar">
          <div className="row" style={{ gap: "0.5rem" }}>
            <AdminIcon name="folder" />
            <span>
              Collection: <strong>{collectionFilter}</strong> ({rows.length} shown)
            </span>
          </div>
          <div className="row" style={{ gap: "0.45rem" }}>
            {organizer && rows.length > 0 && (
              <button
                type="button"
                className="primary small"
                onClick={() => setAssignState({ rows, surface: "CONTEST" })}
              >
                Assign collection ({rows.length})…
              </button>
            )}
            <button type="button" className="small" onClick={() => setCollectionFilter("")}>
              Clear collection filter
            </button>
          </div>
        </div>
      )}

      <ErrorBox error={list.error} />

      {list.loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>
          {showDeleted
            ? "No deleted problems."
            : hasFilters
            ? "No problems match the current filters."
            : "Your Problem Bank is empty. Bulk import a bank file or create a new problem to get started."}
        </Empty>
      ) : (
        <section className="table-card">
          {!showDeleted && organizer && selectedRows.length > 0 && (
            <div className="bulk-bar">
              <div className="bulk-left">
                <strong>{selectedRows.length} selected</strong>
                <button type="button" className="ghost" onClick={() => setSelected(new Set())}>
                  Clear selection
                </button>
              </div>
              <div className="bulk-right">
                {selectedReviewReady.length > 0 && (
                  <button type="button" disabled={busy} onClick={() => void approveSelected()}>
                    <AdminIcon name="check" /> Approve ({selectedReviewReady.length})
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => setTagsTarget(selectedRows)}>
                  Topics…
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAssignState({ rows: selectedRows, surface: "COLLECTION" })}
                >
                  <AdminIcon name="folder" /> Collection…
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => setAssignState({ rows: selectedRows, surface: "PRACTICE" })}
                >
                  Assign to… ({selectedRows.length})
                </button>
              </div>
            </div>
          )}

          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {!showDeleted && organizer && (
                    <th className="col-check">
                      <input
                        type="checkbox"
                        checked={allShownSelected}
                        onChange={toggleAllShown}
                        aria-label="Select all visible problems"
                      />
                    </th>
                  )}
                  <th>Problem</th>
                  <th className="col-shrink">Level</th>
                  <th className="col-shrink">State</th>
                  {!showDeleted && <th className="col-shrink">Assigned to</th>}
                  <th className="col-shrink right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const isSel = selected.has(p.version_id);
                  const topics = p.tags ?? [];
                  const topicSummary = topics.map(topicLabel).join(", ");
                  return (
                    <tr
                      key={p.version_id}
                      className={
                        (isSel ? "row-selected " : "") + (!showDeleted && organizer ? "row-clickable" : "")
                      }
                      onClick={() => !showDeleted && organizer && toggleOne(p.version_id)}
                    >
                      {!showDeleted && organizer && (
                        <td className="col-check" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleOne(p.version_id)}
                            aria-label={"Select " + p.title}
                          />
                        </td>
                      )}
                      <td className="col-problem">
                        <div className="cell-primary">
                          <a
                            href={"#/admin/problems/" + p.version_id}
                            className="cell-title"
                            title={p.title}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.title}
                          </a>
                          {p.folder && (
                            <button
                              type="button"
                              className="collection-pill"
                              title={"Filter by collection: " + p.folder}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCollectionFilter(p.folder ?? "");
                              }}
                            >
                              {p.folder}
                            </button>
                          )}
                        </div>
                        <div className="cell-secondary">
                          <span className="cell-slug">
                            {p.slug}
                            {p.version_number > 1 ? ` · v${p.version_number}` : ""}
                          </span>
                          {topics.length > 0 && (
                            <span className="cell-topics" title={topicSummary}>
                              · {topicSummary}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="col-shrink">
                        <DifficultyPill value={p.difficulty ?? "MEDIUM"} />
                      </td>
                      <td className="col-shrink">{statusBadge(p)}</td>
                      {!showDeleted && (
                        <td className="col-shrink">
                          <PlacementPills row={p} />
                        </td>
                      )}
                      <td className="col-shrink right" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          {showDeleted ? (
                            <button
                              type="button"
                              className="primary"
                              onClick={() => setDeleteTarget({ row: p, action: "restore" })}
                            >
                              Restore
                            </button>
                          ) : (
                            <>
                              {organizer && (
                                <button
                                  type="button"
                                  className="primary"
                                  onClick={() => setAssignState({ rows: [p], surface: "PRACTICE" })}
                                >
                                  Assign
                                </button>
                              )}
                              <button
                                type="button"
                                className="icon-btn"
                                onClick={() => setPreviewId(p.version_id)}
                                title="Preview as student"
                                aria-label={"Preview " + p.title}
                              >
                                <AdminIcon name="eye" size={14} />
                              </button>
                              <a
                                className="btn icon-btn"
                                href={"#/admin/problems/" + p.version_id}
                                title="Edit problem"
                                aria-label={"Edit " + p.title}
                              >
                                <AdminIcon name="edit" size={14} />
                              </a>
                              <button
                                type="button"
                                className="icon-btn danger"
                                onClick={() => setDeleteTarget({ row: p, action: "delete" })}
                                title="Delete problem"
                                aria-label={"Delete " + p.title}
                              >
                                <AdminIcon name="trash" size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="row-between small muted">
        <span>
          Showing {rows.length} of {all.length} problem{all.length === 1 ? "" : "s"}.
        </span>
        {!showDeleted && organizer && (
          <span>Select one or more rows to bulk-assign to Practice, TDs, Missions, Duel Pool, Contests, or Collections.</span>
        )}
      </div>

      {assignState && (
        <AssignModal
          problems={assignState.rows}
          initialSurface={assignState.surface}
          onClose={() => setAssignState(null)}
          onDone={() => {
            setSelected(new Set());
            reloadAll();
          }}
        />
      )}

      {previewId && (
        <ProblemPreviewModal
          versionId={previewId}
          onClose={() => setPreviewId(null)}
          onAssign={
            organizer
              ? () => {
                  const found = all.find((x) => x.version_id === previewId);
                  if (found) setAssignState({ rows: [found], surface: "PRACTICE" });
                }
              : undefined
          }
        />
      )}

      {collectionsOpen && (
        <CollectionsModal
          onChanged={reloadAll}
          onSelectCollection={(name) => setCollectionFilter(name)}
          onClose={() => setCollectionsOpen(false)}
        />
      )}

      {tagsTarget && (
        <BulkTagsModal
          problems={tagsTarget}
          onDone={() => {
            setSelected(new Set());
            reloadAll();
          }}
          onClose={() => setTagsTarget(null)}
        />
      )}

      {deleteTarget && (
        <ReasonDialog
          title={(deleteTarget.action === "delete" ? "Delete “" : "Restore “") + deleteTarget.row.title + "”"}
          confirm={deleteTarget.action === "delete" ? "Delete problem" : "Restore"}
          danger={deleteTarget.action === "delete"}
          onClose={() => setDeleteTarget(null)}
          description={
            deleteTarget.action === "delete"
              ? "Hides the problem from Practice, TDs, Missions, and Duels and moves it to Deleted. Finished contest standings and past submissions stay intact."
              : "Restores the problem back into your Private Problem Bank. You can re-assign it to any surface afterwards."
          }
          onSubmit={(reason) =>
            run(
              async () => {
                await post("/api/lab/problems/" + deleteTarget.row.version_id + "/" + deleteTarget.action, { reason });
                setDeleteTarget(null);
                reloadAll();
              },
              deleteTarget.action === "delete" ? "Problem deleted" : "Problem restored",
            )
          }
        />
      )}
    </div>
  );
}

type Version = {
  id: string;
  problem_id: string;
  title: string;
  status: string;
  version_number: number;
  sealed_at: string | null;
  difficulty: string;
  checker: string;
  statement_md: string;
  input_format_md: string;
  output_format_md: string;
  constraints_md: string;
  explanation_md: string;
  setter_notes: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  output_limit_kb: number;
  function_signature: string | null;
  tests: { id: string; input_data: string; expected_output: string; is_sample: boolean }[];
  references: { id: string; label: string; language_code: string; expected_verdict: string; source_code: string }[];
  validations: { id: string; status: string; report: string; created_at: string; completed_at: string | null }[];
  languages: string[];
};

export function ProblemEditor({ versionId }: { versionId: string }) {
  const { organizer } = useAuth();
  const v = useData<Version>("/api/lab/problems/" + versionId, 0);
  const bankList = useData<BankRow[]>(organizer ? "/api/lab/problems" : null);
  const [tab, setTab] = useState<"statement" | "tests" | "references" | "validation">("statement");
  const { busy, run } = useAction();
  const [approving, setApproving] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const validating = v.data?.validations[0]?.status === "PENDING" || v.data?.validations[0]?.status === "RUNNING";
  const reload = v.reload;

  useEffect(() => {
    if (!validating) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [validating, reload]);

  if (v.loading) return <Loading />;
  if (!v.data) return <ErrorBox error={v.error} />;

  const p = v.data;
  const sealed = Boolean(p.sealed_at);
  const bankRow = (bankList.data ?? []).find((x) => x.version_id === p.id);

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div>
        <a href="#/admin/problems" className="btn small ghost" style={{ paddingLeft: 0 }}>
          <AdminIcon name="arrowLeft" /> Back to Problem Bank
        </a>
      </div>

      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>
            {p.title} <span className="muted">v{p.version_number}</span>
          </h1>
          <div className="row" style={{ gap: "0.5rem" }}>
            <Badge tone={STATUS_TONE[p.status]}>{p.status.replace(/_/g, " ")}</Badge>
            {sealed && <Badge>Sealed (immutable)</Badge>}
            {bankRow && <PlacementPills row={bankRow} />}
          </div>
        </div>
        <div className="row" style={{ gap: "0.5rem" }}>
          <button type="button" onClick={() => setPreviewOpen(true)}>
            <AdminIcon name="eye" /> Preview
          </button>
          {sealed && (
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await post<{ versionId: string }>("/api/lab/problems/" + p.id + "/clone");
                  navigate("/admin/problems/" + r.versionId);
                }, "New editable version created")
              }
            >
              Clone to edit
            </button>
          )}
          {!sealed && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await post("/api/lab/problems/" + p.id + "/validate");
                  setTab("validation");
                  await v.reload();
                }, "Validation queued on the internal judge lane")
              }
            >
              Seal & validate
            </button>
          )}
          {p.status === "READY_FOR_REVIEW" && (
            <button className="primary" onClick={() => setApproving(true)}>
              Approve…
            </button>
          )}
          {organizer && bankRow && (
            <button className="primary" onClick={() => setAssignOpen(true)}>
              Assign…
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {(["statement", "tests", "references", "validation"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "statement" && <StatementForm p={p} sealed={sealed} onSaved={v.reload} />}
      {tab === "tests" && <TestsForm p={p} sealed={sealed} onSaved={v.reload} />}
      {tab === "references" && <References p={p} sealed={sealed} onSaved={v.reload} />}
      {tab === "validation" && (
        <div className="stack">
          {p.validations.length === 0 ? (
            <Empty>Not validated yet. Validation runs every reference solution against every test in the real sandbox.</Empty>
          ) : (
            p.validations.map((r) => (
              <div key={r.id} className="card">
                <div className="row-between">
                  <Badge
                    tone={
                      r.status === "PASSED"
                        ? "ok"
                        : r.status === "FAILED" || r.status === "JUDGE_ERROR"
                        ? "bad"
                        : "info"
                    }
                  >
                    {r.status}
                  </Badge>
                  <span className="small muted">{when(r.created_at)}</span>
                </div>
                {r.report && r.report !== "{}" && (
                  <pre className="card-flat small" style={{ marginTop: "0.75rem" }}>
                    {JSON.stringify(JSON.parse(r.report), null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {approving && (
        <ReasonDialog
          title="Approve problem version"
          confirm="Approve"
          onClose={() => setApproving(false)}
          onSubmit={(reason) =>
            run(async () => {
              await post("/api/lab/problems/" + p.id + "/approve", { reason });
              setApproving(false);
              await Promise.all([v.reload(), bankList.reload()]);
            }, "Approved")
          }
        />
      )}

      {previewOpen && (
        <ProblemPreviewModal
          versionId={p.id}
          onClose={() => setPreviewOpen(false)}
          onAssign={organizer && bankRow ? () => setAssignOpen(true) : undefined}
        />
      )}

      {assignOpen && bankRow && (
        <AssignModal
          problems={[bankRow]}
          onClose={() => setAssignOpen(false)}
          onDone={() => {
            void v.reload();
            void bankList.reload();
          }}
        />
      )}
    </div>
  );
}

function StatementForm({ p, sealed, onSaved }: { p: Version; sealed: boolean; onSaved: () => void }) {
  const [f, setF] = useState({
    title: p.title,
    statement: p.statement_md,
    inputFormat: p.input_format_md,
    outputFormat: p.output_format_md,
    constraints: p.constraints_md,
    explanation: p.explanation_md,
    setterNotes: p.setter_notes,
    difficulty: p.difficulty,
    checker: p.checker,
    timeLimitMs: p.time_limit_ms,
    memoryLimitMb: p.memory_limit_mb,
    outputLimitKb: p.output_limit_kb,
    languages: p.languages,
    functionSignature: parseSignature(p.function_signature),
  });
  const signature = f.functionSignature;
  const setSignature = (next: Signature | null) =>
    setF({
      ...f,
      functionSignature: next,
      languages: next ? f.languages.filter((l) => FUNCTION_LANGUAGES.includes(l)) : f.languages,
    });
  const [preview, setPreview] = useState(true);
  const { busy, run } = useAction();
  const text = (key: keyof typeof f, label: string, rows = 4) => (
    <Field label={label}>
      <textarea
        rows={rows}
        disabled={sealed}
        value={f[key] as string}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await patch("/api/lab/problems/" + p.id, f);
            onSaved();
          }, "Saved");
        }}
      >
        <Field label="Title">
          <input disabled={sealed} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        {text("statement", "Statement (Markdown)", 10)}
        <Field
          label="How contestants answer"
          hint="A function works like LeetCode: contestants complete one function and never read input."
        >
          <select
            disabled={sealed}
            value={signature ? "FUNCTION" : "STDIO"}
            onChange={(e) => setSignature(e.target.value === "FUNCTION" ? EMPTY_SIGNATURE : null)}
          >
            <option value="STDIO">Full program (standard input and output)</option>
            <option value="FUNCTION">Complete a function (LeetCode style)</option>
          </select>
        </Field>
        {signature && <SignatureEditor value={signature} onChange={setSignature} disabled={sealed} />}
        {!signature && text("inputFormat", "Input format")}
        {!signature && text("outputFormat", "Output format")}
        {text("constraints", "Constraints", 3)}
        {text("explanation", "Notes / explanation", 3)}
        {text("setterNotes", "Private setter notes (never shown to contestants)", 3)}
        <div className="grid grid-3">
          <Field label="Time limit (ms)">
            <input
              type="number"
              min={1}
              max={60000}
              disabled={sealed}
              value={f.timeLimitMs}
              onChange={(e) => setF({ ...f, timeLimitMs: Number(e.target.value) })}
            />
          </Field>
          <Field label="Memory (MB)" hint="Must fit the worker slot memory.">
            <input
              type="number"
              min={16}
              max={4096}
              disabled={sealed}
              value={f.memoryLimitMb}
              onChange={(e) => setF({ ...f, memoryLimitMb: Number(e.target.value) })}
            />
          </Field>
          <Field label="Output (KB)">
            <input
              type="number"
              min={1}
              max={65536}
              disabled={sealed}
              value={f.outputLimitKb}
              onChange={(e) => setF({ ...f, outputLimitKb: Number(e.target.value) })}
            />
          </Field>
          <Field label="Checker" hint={signature ? "Not used: function results are compared as values." : undefined}>
            <select
              disabled={sealed || Boolean(signature)}
              value={f.checker}
              onChange={(e) => setF({ ...f, checker: e.target.value })}
            >
              <option value="TRIMMED_LINES">Trimmed lines</option>
              <option value="TOKENS">Tokens</option>
              <option value="EXACT">Exact</option>
            </select>
          </Field>
          <Field label="Difficulty">
            <select disabled={sealed} value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>
              <option>EASY</option>
              <option>MEDIUM</option>
              <option>HARD</option>
            </select>
          </Field>
        </div>
        <Field label="Languages">
          <LanguagePicker
            disabled={sealed}
            value={f.languages}
            onChange={(languages) => setF({ ...f, languages })}
            allowed={signature ? FUNCTION_LANGUAGES : undefined}
          />
        </Field>
        {!sealed && (
          <div>
            <button className="primary" disabled={busy}>
              Save draft
            </button>
          </div>
        )}
      </form>
      <div className="card">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>Live Markdown preview</h3>
          <button className="small" onClick={() => setPreview(!preview)}>
            {preview ? "Hide" : "Show"}
          </button>
        </div>
        {preview && signature && (
          <div className="statement" style={{ marginTop: "0.75rem" }}>
            <h2>{f.title}</h2>
            <Markdown text={f.statement} />
            <h3>Function</h3>
            <pre className="card-flat small mono">{describe(signature)}</pre>
          </div>
        )}
        {preview && !signature && (
          <div className="statement" style={{ marginTop: "0.75rem" }}>
            <h2>{f.title}</h2>
            <Markdown text={f.statement} />
            {f.inputFormat && (
              <>
                <h3>Input</h3>
                <Markdown text={f.inputFormat} />
              </>
            )}
            {f.outputFormat && (
              <>
                <h3>Output</h3>
                <Markdown text={f.outputFormat} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TestsForm({ p, sealed, onSaved }: { p: Version; sealed: boolean; onSaved: () => void }) {
  const [tests, setTests] = useState(
    p.tests.map((t) => ({ input: t.input_data, expected: t.expected_output, sample: t.is_sample })),
  );
  const { busy, run } = useAction();
  const update = (i: number, change: Partial<(typeof tests)[number]>) =>
    setTests(tests.map((t, j) => (i === j ? { ...t, ...change } : t)));
  return (
    <div className="stack">
      <div className="notice small">
        Tests replace the whole suite (1–200 tests, 16 MiB total). Mark at least one sample (shown in the statement) and keep at least one hidden test.
        {p.function_signature &&
          " Function problem: each input has one JSON value per parameter line, and the expected output is the return value as JSON."}
      </div>
      {tests.map((t, i) => (
        <div key={i} className="card stack">
          <div className="row-between">
            <strong>Test {i + 1}</strong>
            <div className="row">
              <label className="check small">
                <input
                  type="checkbox"
                  disabled={sealed}
                  checked={t.sample}
                  onChange={(e) => update(i, { sample: e.target.checked })}
                />
                Sample
              </label>
              {!sealed && (
                <button className="small danger" onClick={() => setTests(tests.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-2">
            <Field label="Input">
              <textarea
                className="mono"
                rows={4}
                disabled={sealed}
                value={t.input}
                onChange={(e) => update(i, { input: e.target.value })}
              />
            </Field>
            <Field label="Expected output">
              <textarea
                className="mono"
                rows={4}
                disabled={sealed}
                value={t.expected}
                onChange={(e) => update(i, { expected: e.target.value })}
              />
            </Field>
          </div>
        </div>
      ))}
      {!sealed && (
        <div className="row">
          <button onClick={() => setTests([...tests, { input: "", expected: "", sample: tests.length === 0 }])}>
            Add test
          </button>
          <button
            className="primary"
            disabled={busy || tests.length === 0}
            onClick={() =>
              run(async () => {
                await put("/api/lab/problems/" + p.id + "/tests", tests);
                onSaved();
              }, "Test suite saved")
            }
          >
            Save suite
          </button>
        </div>
      )}
    </div>
  );
}

function References({ p, sealed, onSaved }: { p: Version; sealed: boolean; onSaved: () => void }) {
  const signature = parseSignature(p.function_signature);
  const [form, setForm] = useState(() => ({
    label: "Main solution",
    language: p.languages[0] ?? "CPP",
    expectedVerdict: "ACCEPTED",
    sourceCode: signature ? templateFor(p.languages[0] ?? "CPP", signature) : "",
  }));
  const { busy, run } = useAction();
  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <div className="stack">
        {p.references.length === 0 ? (
          <Empty>Add at least one reference expected to be accepted.</Empty>
        ) : (
          p.references.map((r) => (
            <div key={r.id} className="card stack">
              <div className="row-between">
                <strong>{r.label}</strong>
                <div className="row">
                  <Badge>{LANGUAGE_NAMES[r.language_code]}</Badge>
                  <Badge tone={VERDICTS[r.expected_verdict]?.tone}>
                    expects {VERDICTS[r.expected_verdict]?.short}
                  </Badge>
                </div>
              </div>
              <pre className="card-flat small mono" style={{ maxHeight: 200, overflow: "auto" }}>
                {r.source_code}
              </pre>
            </div>
          ))
        )}
      </div>
      {!sealed && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await post("/api/lab/problems/" + p.id + "/references", form);
              setForm({ ...form, sourceCode: "" });
              onSaved();
            }, "Reference added");
          }}
        >
          <h3>Add reference solution</h3>
          <div className="grid grid-3">
            <Field label="Label">
              <input required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </Field>
            <Field label="Language">
              <select
                value={form.language}
                onChange={(e) =>
                  setForm({
                    ...form,
                    language: e.target.value,
                    sourceCode:
                      signature && (!form.sourceCode.trim() || form.sourceCode === templateFor(form.language, signature))
                        ? templateFor(e.target.value, signature)
                        : form.sourceCode,
                  })
                }
              >
                {p.languages.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_NAMES[l]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Expected verdict">
              <select
                value={form.expectedVerdict}
                onChange={(e) => setForm({ ...form, expectedVerdict: e.target.value })}
              >
                {Object.entries(VERDICTS)
                  .filter(([k]) => k !== "JUDGE_ERROR")
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <div style={{ height: 320, display: "flex" }}>
            <CodeEditor value={form.sourceCode} onChange={(s) => setForm({ ...form, sourceCode: s })} language={form.language} />
          </div>
          <div>
            <button className="primary" disabled={busy || !form.sourceCode.trim()}>
              Add reference
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
