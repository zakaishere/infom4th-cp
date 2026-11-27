import { useMemo, useState } from "react";
import { patch, post } from "../../api";
import { navigate, useAction, useData, useToast } from "../../app";
import { AdminIcon } from "../../components/AdminIcons";
import { DifficultyPill } from "../Practice";
import { Badge, Empty, ErrorBox, Loading, Stat } from "../../ui";
import { ProblemPreviewModal, isPubliclyVisible, isReadyToAssign, type BankRow } from "./ProblemModals";

type PoolRow = {
  problem_id: string;
  id: string;
  title: string;
  slug: string;
  difficulty: string;
  version_number: number;
  hidden: boolean;
  published_at: string;
  rounds_played: number;
};

type Managed = {
  pool: PoolRow[];
};

/** Focused surface manager for the private Duel Pool. */
export default function DuelProblems() {
  const data = useData<Managed>("/api/manage/duel-problems", 30000);
  const bank = useData<BankRow[]>("/api/lab/problems");
  const { busy, run } = useAction();

  const [filter, setFilter] = useState("");
  const [difficulty, setDifficulty] = useState<"" | "EASY" | "MEDIUM" | "HARD">("");
  const [stateFilter, setStateFilter] = useState<"" | "ACTIVE" | "HIDDEN">("");
  const [addOpen, setAddOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  if (data.loading) return <Loading />;
  if (!data.data) return <ErrorBox error={data.error} />;

  const pool = data.data.pool;
  const active = pool.filter((p) => !p.hidden);
  const count = (d: string) => active.filter((p) => p.difficulty === d).length;

  const shown = pool.filter((p) => {
    if (difficulty && p.difficulty !== difficulty) return false;
    if (stateFilter === "ACTIVE" && p.hidden) return false;
    if (stateFilter === "HIDDEN" && !p.hidden) return false;
    if (filter.trim() && !(p.title + " " + p.slug).toLowerCase().includes(filter.trim().toLowerCase())) return false;
    return true;
  });

  const toggle = (p: PoolRow) =>
    run(async () => {
      await patch("/api/manage/duel-problems/" + p.problem_id, { hidden: !p.hidden });
      await Promise.all([data.reload(), bank.reload()]);
    }, p.hidden ? "Restored to Duel Pool" : "Hidden from new duels");

  return (
    <div className="stack" style={{ gap: "1.1rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Build</div>
          <h1>Duel Pool</h1>
          <p>
            Private short problems drawn in blitz duels. Keep at least 5 active problems per difficulty for Best-of-5 rooms.
          </p>
        </div>
        <div className="row" style={{ gap: "0.5rem" }}>
          <button onClick={() => navigate("/admin/problems")}>
            <AdminIcon name="bank" /> Problem Bank
          </button>
          <button className="primary" onClick={() => setAddOpen(true)}>
            <AdminIcon name="plus" /> Add from Bank
          </button>
        </div>
      </div>

      <div className="stat-tiles">
        <Stat
          label="Active in pool"
          value={active.length}
          tone={active.length >= 5 ? "ok" : "warn"}
          hint={active.length < 5 ? "Best of 5 needs 5+" : undefined}
        />
        <Stat label="Easy · Med · Hard" value={`${count("EASY")} · ${count("MEDIUM")} · ${count("HARD")}`} />
        <Stat label="Hidden" value={pool.length - active.length} />
        <Stat label="Rounds played" value={pool.reduce((n, p) => n + Number(p.rounds_played), 0)} />
      </div>

      <div className="admin-toolbar">
        <input
          className="toolbar-search"
          placeholder="Search title or slug…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
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
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}
          aria-label="Pool state filter"
        >
          <option value="">All states</option>
          <option value="ACTIVE">Active only</option>
          <option value="HIDDEN">Hidden only</option>
        </select>
        {(filter || difficulty || stateFilter) && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setFilter("");
              setDifficulty("");
              setStateFilter("");
            }}
          >
            Reset
          </button>
        )}
      </div>

      {pool.length === 0 ? (
        <Empty>
          No duel problems yet. Import problems into your <strong>Problem Bank</strong> and click <strong>Add from Bank</strong>.
        </Empty>
      ) : shown.length === 0 ? (
        <Empty>No duel problems match these filters.</Empty>
      ) : (
        <section className="table-card">
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Problem</th>
                  <th className="col-shrink">Level</th>
                  <th className="col-shrink">Version</th>
                  <th className="col-shrink">Rounds played</th>
                  <th className="col-shrink">State</th>
                  <th className="col-shrink right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.problem_id} className={p.hidden ? "hidden-row" : ""}>
                    <td className="col-problem">
                      <div className="cell-primary">
                        <a href={"#/admin/problems/" + p.id} className="cell-title">
                          {p.title}
                        </a>
                      </div>
                      <div className="cell-secondary">
                        <span className="cell-slug">{p.slug}</span>
                      </div>
                    </td>
                    <td className="col-shrink">
                      <DifficultyPill value={p.difficulty} />
                    </td>
                    <td className="col-shrink mono small">v{p.version_number}</td>
                    <td className="col-shrink mono small">{p.rounds_played}</td>
                    <td className="col-shrink">
                      {p.hidden ? (
                        <span className="state-ind neutral">Hidden</span>
                      ) : (
                        <span className="state-ind ok">Active</span>
                      )}
                    </td>
                    <td className="col-shrink right">
                      <div className="row-actions">
                        <button type="button" disabled={busy} onClick={() => void toggle(p)}>
                          {p.hidden ? "Show" : "Hide"}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setPreviewId(p.id)}
                          title="Preview as student"
                        >
                          <AdminIcon name="eye" size={14} />
                        </button>
                        <a className="btn icon-btn" href={"#/admin/problems/" + p.id} title="Edit problem">
                          <AdminIcon name="edit" size={14} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {addOpen && (
        <DuelBankPickerModal
          bank={bank.data ?? []}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            void data.reload();
            void bank.reload();
          }}
        />
      )}

      {previewId && <ProblemPreviewModal versionId={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

function DuelBankPickerModal({
  bank,
  onDone,
  onClose,
}: {
  bank: BankRow[];
  onDone: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [diff, setDiff] = useState<"" | "EASY" | "MEDIUM" | "HARD">("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const query = q.trim().toLowerCase();
    return bank.filter((p) => {
      if (!isReadyToAssign(p)) return false;
      if (p.in_duel_pool) return false;
      if (diff && (p.difficulty ?? "MEDIUM") !== diff) return false;
      if (query && !(p.title + " " + p.slug + " " + (p.folder ?? "")).toLowerCase().includes(query)) return false;
      return true;
    });
  }, [bank, diff, q]);

  const leakSelected = useMemo(
    () => candidates.filter((p) => picked.has(p.version_id) && isPubliclyVisible(p)),
    [candidates, picked],
  );

  const toggle = (versionId: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(versionId)) next.delete(versionId);
      else next.add(versionId);
      return next;
    });

  async function addSelected() {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      await post("/api/lab/problems/assign", {
        versionIds: [...picked],
        surface: "DUEL",
        action: "add",
      });
      toast("success", `Added ${picked.size} problem${picked.size === 1 ? "" : "s"} to Duel Pool`);
      onDone();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Could not add duel problems");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" role="dialog" aria-modal="true" aria-label="Add problems to Duel Pool">
        <div className="row-between" style={{ marginBottom: "0.85rem" }}>
          <h2 style={{ margin: 0 }}>Add problems to Duel Pool</h2>
          <button className="ghost small" onClick={onClose}>
            <AdminIcon name="close" />
          </button>
        </div>

        <div className="stack" style={{ gap: "0.85rem" }}>
          <div className="admin-toolbar">
            <input
              className="toolbar-search"
              placeholder="Search title, slug, or collection…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="seg-group">
              {([
                ["", "All"],
                ["EASY", "Easy"],
                ["MEDIUM", "Med"],
                ["HARD", "Hard"],
              ] as const).map(([v, l]) => (
                <button key={v || "all"} type="button" className={diff === v ? "active" : ""} onClick={() => setDiff(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {leakSelected.length > 0 && (
            <div className="notice warn small" style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start" }}>
              <AdminIcon name="warning" size={16} />
              <span>
                <strong>Visibility warning:</strong> {leakSelected.length} selected problem
                {leakSelected.length === 1 ? " is" : "s are"} already public in Practice, a TD, or a Mission.
              </span>
            </div>
          )}

          {candidates.length === 0 ? (
            <Empty>No unused ready problems found in your Problem Bank.</Empty>
          ) : (
            <div className="collection-list" style={{ maxHeight: 340 }}>
              {candidates.map((p) => (
                <label
                  key={p.version_id}
                  className="collection-row"
                  style={{ cursor: "pointer", justifyContent: "flex-start", gap: "0.65rem" }}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(p.version_id)}
                    onChange={() => toggle(p.version_id)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cell-primary">
                      <span className="cell-title">{p.title}</span>
                      {p.folder && <span className="collection-pill">{p.folder}</span>}
                      {isPubliclyVisible(p) && <Badge tone="warn">Public</Badge>}
                    </div>
                    <div className="cell-secondary">
                      <span className="cell-slug">{p.slug}</span>
                    </div>
                  </div>
                  <DifficultyPill value={p.difficulty ?? "MEDIUM"} />
                </label>
              ))}
            </div>
          )}

          <div className="row-between">
            <span className="small muted">{picked.size} selected</span>
            <div className="row" style={{ gap: "0.5rem" }}>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || picked.size === 0}
                onClick={() => void addSelected()}
              >
                {busy ? "Adding…" : `Add ${picked.size || ""} to Duel Pool`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
