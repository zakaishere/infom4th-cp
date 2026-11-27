import { useMemo, useState } from "react";
import { patch } from "../../api";
import { navigate, useAction, useData } from "../../app";
import { AdminIcon } from "../../components/AdminIcons";
import { topicLabel } from "../../lib/topics";
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Stat } from "../../ui";
import { DifficultyPill, acceptance, type PracticeProblem } from "../Practice";
import { BulkTagsModal, ProblemPreviewModal, type BankRow } from "./ProblemModals";

type PublishedRow = PracticeProblem & { hidden: boolean };
type Managed = {
  published: PublishedRow[];
  tags: string[];
};

const DIFF_RANK: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3 };

const TD_THEMES: Record<number, string> = {
  1: "Operateurs, conditions et E/S",
  2: "Boucles",
  3: "Tableaux et matrices",
  4: "Chaines de caracteres",
  5: "Pointeurs, fonctions et allocation",
  6: "Fichiers",
};

/** Focused surface manager for Public Practice and Academic TDs. */
export default function PracticeSet() {
  const data = useData<Managed>("/api/manage/practice", 30000);
  const { busy, run } = useAction();

  const [tab, setTab] = useState<"PRACTICE" | "TD">("PRACTICE");
  const [q, setQ] = useState("");
  const [difficulty, setDifficulty] = useState<"" | "EASY" | "MEDIUM" | "HARD">("");
  const [visibilityFilter, setVisibilityFilter] = useState<"" | "PUBLIC" | "HIDDEN">("");
  const [tdFilter, setTdFilter] = useState<number | "">("");
  const [sort, setSort] = useState<"newest" | "easiest" | "hardest" | "popular" | "title">("newest");

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [tagsRow, setTagsRow] = useState<PublishedRow | null>(null);
  const [moveTdRow, setMoveTdRow] = useState<{ row: PublishedRow; td: number } | null>(null);

  const published = data.data?.published ?? [];
  const practiceRows = useMemo(() => published.filter((p) => p.td_number == null), [published]);
  const tdRows = useMemo(() => published.filter((p) => p.td_number != null), [published]);

  const distinctTds = useMemo(() => {
    const nums = new Set<number>();
    for (const p of tdRows) if (p.td_number != null) nums.add(p.td_number);
    return [...nums].sort((a, b) => a - b);
  }, [tdRows]);

  const shown = useMemo(() => {
    const pool = tab === "PRACTICE" ? practiceRows : tdRows;
    const query = q.trim().toLowerCase();
    const filtered = pool.filter((p) => {
      if (query && !(p.title + " " + p.slug + " " + p.tags.join(" ")).toLowerCase().includes(query)) return false;
      if (difficulty && p.difficulty !== difficulty) return false;
      if (visibilityFilter === "PUBLIC" && p.hidden) return false;
      if (visibilityFilter === "HIDDEN" && !p.hidden) return false;
      if (tab === "TD" && tdFilter !== "" && p.td_number !== tdFilter) return false;
      return true;
    });

    if (tab === "TD") {
      return [...filtered].sort(
        (a, b) =>
          (a.td_number ?? 0) - (b.td_number ?? 0) ||
          (a.td_position ?? 0) - (b.td_position ?? 0) ||
          a.title.localeCompare(b.title),
      );
    }

    const sorters: Record<typeof sort, (a: PublishedRow, b: PublishedRow) => number> = {
      newest: (a, b) => b.published_at.localeCompare(a.published_at),
      easiest: (a, b) => (DIFF_RANK[a.difficulty] ?? 2) - (DIFF_RANK[b.difficulty] ?? 2) || a.title.localeCompare(b.title),
      hardest: (a, b) => (DIFF_RANK[b.difficulty] ?? 2) - (DIFF_RANK[a.difficulty] ?? 2) || a.title.localeCompare(b.title),
      popular: (a, b) => b.solved_by - a.solved_by,
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return [...filtered].sort(sorters[sort]);
  }, [tab, practiceRows, tdRows, q, difficulty, visibilityFilter, tdFilter, sort]);

  if (data.loading) return <Loading />;
  if (!data.data) return <ErrorBox error={data.error} />;

  const save = (p: PublishedRow, body: Record<string, unknown>, message: string) =>
    run(async () => {
      await patch("/api/manage/practice/" + p.problem_id, body);
      await data.reload();
    }, message);

  const shiftTdOrder = (row: PublishedRow, delta: -1 | 1) => {
    const siblings = tdRows
      .filter((x) => x.td_number === row.td_number)
      .sort((a, b) => (a.td_position ?? 0) - (b.td_position ?? 0) || a.title.localeCompare(b.title));
    const idx = siblings.findIndex((x) => x.problem_id === row.problem_id);
    const swapIdx = idx + delta;
    if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return;
    void run(async () => {
      const nextOrder = [...siblings];
      const [moved] = nextOrder.splice(idx, 1);
      nextOrder.splice(swapIdx, 0, moved);
      for (let i = 0; i < nextOrder.length; i++) {
        await patch("/api/manage/practice/" + nextOrder[i].problem_id, {
          td: row.td_number,
          tdPosition: i + 1,
        });
      }
      await data.reload();
    }, "Course order updated");
  };

  const hasFilters = Boolean(q || difficulty || visibilityFilter || tdFilter !== "");

  return (
    <div className="stack" style={{ gap: "1.1rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Build</div>
          <h1>Practice & TDs</h1>
          <p>
            Manage visibility, topics, and TD course ordering for published problems. Add new problems from the Problem Bank.
          </p>
        </div>
        <div className="row" style={{ gap: "0.5rem" }}>
          <a className="btn" href={tab === "TD" ? "#/td" : "#/"}>
            Open public page
          </a>
          <button className="primary" onClick={() => navigate("/admin/problems")}>
            <AdminIcon name="bank" /> Assign from Problem Bank
          </button>
        </div>
      </div>

      <div className="stat-tiles">
        <Stat label="Public Practice" value={practiceRows.filter((p) => !p.hidden).length} tone="ok" />
        <Stat label="Academic TD exercises" value={tdRows.filter((p) => !p.hidden).length} tone="info" />
        <Stat label="Hidden" value={published.filter((p) => p.hidden).length} />
        <Stat label="Accepted solutions" value={published.reduce((n, p) => n + Number(p.accepted), 0)} />
      </div>

      <div className="scope-tabs" role="tablist" aria-label="Surface section">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "PRACTICE"}
          className={"scope-tab" + (tab === "PRACTICE" ? " active" : "")}
          onClick={() => setTab("PRACTICE")}
        >
          Public Practice <span className="tab-count">{practiceRows.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "TD"}
          className={"scope-tab" + (tab === "TD" ? " active" : "")}
          onClick={() => setTab("TD")}
        >
          Academic TDs <span className="tab-count">{tdRows.length}</span>
        </button>
      </div>

      <div className="admin-toolbar">
        <input
          className="toolbar-search"
          placeholder="Search title, slug, or topic…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {tab === "TD" && (
          <select
            value={tdFilter}
            onChange={(e) => setTdFilter(e.target.value ? Number(e.target.value) : "")}
            aria-label="Filter by TD session"
          >
            <option value="">All TD sessions</option>
            {distinctTds.map((n) => (
              <option key={n} value={n}>
                TD {n}
                {TD_THEMES[n] ? ` — ${TD_THEMES[n]}` : ""}
              </option>
            ))}
          </select>
        )}

        <div className="seg-group" role="group" aria-label="Difficulty filter">
          {([
            ["", "All"],
            ["EASY", "Easy"],
            ["MEDIUM", "Med"],
            ["HARD", "Hard"],
          ] as const).map(([v, lbl]) => (
            <button
              key={v || "all"}
              type="button"
              className={difficulty === v ? "active" : ""}
              onClick={() => setDifficulty(v)}
            >
              {lbl}
            </button>
          ))}
        </div>

        <select
          value={visibilityFilter}
          onChange={(e) => setVisibilityFilter(e.target.value as typeof visibilityFilter)}
          aria-label="Visibility filter"
        >
          <option value="">All visibility</option>
          <option value="PUBLIC">Visible only</option>
          <option value="HIDDEN">Hidden only</option>
        </select>

        {tab === "PRACTICE" && (
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort problems">
            <option value="newest">Newest first</option>
            <option value="easiest">Easiest first</option>
            <option value="hardest">Hardest first</option>
            <option value="popular">Most solved</option>
            <option value="title">Title A–Z</option>
          </select>
        )}

        {hasFilters && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setQ("");
              setDifficulty("");
              setVisibilityFilter("");
              setTdFilter("");
            }}
          >
            Reset
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <Empty>
          {hasFilters ? (
            "No problems match these filters."
          ) : tab === "PRACTICE" ? (
            <>
              No problems published to Public Practice yet. Use <strong>Assign from Problem Bank</strong> to publish approved problems.
            </>
          ) : (
            <>
              No TD exercises assigned yet. Select problems in the <strong>Problem Bank</strong> and assign them to TD 1..N.
            </>
          )}
        </Empty>
      ) : (
        <section className="table-card">
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {tab === "TD" && <th style={{ width: 112 }}>Session</th>}
                  <th>Problem</th>
                  <th style={{ width: 96 }}>Level</th>
                  <th style={{ width: 185 }}>Topics</th>
                  <th style={{ width: 105 }}>Solved</th>
                  <th style={{ width: 96 }}>State</th>
                  <th style={{ width: tab === "TD" ? 265 : 235 }} className="right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const rate = acceptance(p);
                  return (
                    <tr key={p.problem_id} className={p.hidden ? "hidden-row" : ""}>
                      {tab === "TD" && (
                        <td className="mono small">
                          <strong>TD {p.td_number}</strong>
                          <span className="muted"> · #{(p.td_position ?? 0) || 1}</span>
                        </td>
                      )}
                      <td>
                        <div className="cell-primary">
                          <a href={"#/admin/problems/" + p.id} className="cell-title" title={p.title}>
                            {p.title}
                          </a>
                        </div>
                        <div className="cell-secondary">
                          <span className="cell-slug">{p.slug}</span>
                        </div>
                      </td>
                      <td>
                        <DifficultyPill value={p.difficulty} />
                      </td>
                      <td>
                        <div className="surface-pills" title={p.tags.map(topicLabel).join(", ")}>
                          {p.tags.length === 0 ? (
                            <span className="small muted">—</span>
                          ) : (
                            <>
                              {p.tags.slice(0, 2).map((t) => (
                                <span key={t} className="topic-mini">
                                  {topicLabel(t)}
                                </span>
                              ))}
                              {p.tags.length > 2 && <span className="topic-mini">+{p.tags.length - 2}</span>}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="mono small" title={rate == null ? "" : `Acceptance ${rate}%`}>
                        {p.solved_by}/{p.tried_by}
                      </td>
                      <td>{p.hidden ? <Badge tone="neutral">Hidden</Badge> : <Badge tone="ok">Live</Badge>}</td>
                      <td className="right">
                        <div className="row-actions">
                          {tab === "TD" && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                title="Move earlier in TD"
                                onClick={() => shiftTdOrder(p, -1)}
                              >
                                <AdminIcon name="chevronUp" size={13} />
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                title="Move later in TD"
                                onClick={() => shiftTdOrder(p, 1)}
                              >
                                <AdminIcon name="chevronDown" size={13} />
                              </button>
                            </>
                          )}
                          <button type="button" onClick={() => setPreviewId(p.id)}>
                            Preview
                          </button>
                          <button type="button" onClick={() => setTagsRow(p)}>
                            Topics
                          </button>
                          {tab === "PRACTICE" ? (
                            <button type="button" onClick={() => setMoveTdRow({ row: p, td: 1 })}>
                              To TD…
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => save(p, { td: null, tdPosition: 0 }, "Moved to Public Practice")}
                            >
                              To Practice
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              save(
                                p,
                                { hidden: !p.hidden, reason: p.hidden ? "Shown again" : "Hidden" },
                                p.hidden ? "Visible again" : "Hidden",
                              )
                            }
                          >
                            {p.hidden ? "Show" : "Hide"}
                          </button>
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

      {previewId && <ProblemPreviewModal versionId={previewId} onClose={() => setPreviewId(null)} />}

      {tagsRow && (
        <BulkTagsModal
          problems={[
            {
              id: tagsRow.problem_id,
              slug: tagsRow.slug,
              version_id: tagsRow.id,
              title: tagsRow.title,
              version_number: 1,
              status: "PUBLISHED",
              difficulty: tagsRow.difficulty,
              tags: tagsRow.tags,
              deleted_at: null,
            } as BankRow,
          ]}
          onDone={() => void data.reload()}
          onClose={() => setTagsRow(null)}
        />
      )}

      {moveTdRow && (
        <Modal title={`Move "${moveTdRow.row.title}" to TD`} onClose={() => setMoveTdRow(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const target = moveTdRow;
              setMoveTdRow(null);
              void save(target.row, { td: target.td, tdPosition: 99 }, `Moved to TD ${target.td}`);
            }}
          >
            <Field label="TD session (1–99)">
              <select
                value={moveTdRow.td}
                onChange={(e) => setMoveTdRow({ ...moveTdRow, td: Number(e.target.value) })}
              >
                {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    TD {n}
                    {TD_THEMES[n] ? ` — ${TD_THEMES[n]}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
              <button type="button" onClick={() => setMoveTdRow(null)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy}>
                Move to TD {moveTdRow.td}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
