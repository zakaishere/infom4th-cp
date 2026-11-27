import { useMemo, useState } from "react";
import { del, patch, post } from "../../api";
import { navigate, useAction, useData, useToast } from "../../app";
import { AdminIcon } from "../../components/AdminIcons";
import { DifficultyPill } from "../Practice";
import { Badge, Empty, ErrorBox, Field, Loading, Modal, Stat } from "../../ui";
import { ProblemPreviewModal, isReadyToAssign, type BankRow } from "./ProblemModals";

type MissionSummary = {
  slug: string;
  title: string;
  description: string;
  open: boolean;
  problems: number;
  totalPoints: number;
  participants: number;
};

type MissionProblemRow = {
  problemId: string;
  version: string;
  title: string;
  weight: number;
  points: number;
  attempts: number;
  passed: number;
  total: number;
  solved: boolean;
};

type MissionDetail = {
  slug: string;
  title: string;
  description: string;
  open: boolean;
  opens_at: string;
  closes_at: string | null;
  totalPoints: number;
  participants: number;
  me: { problems: MissionProblemRow[] };
};

const fmtPts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

export function AdminMissionList() {
  const data = useData<{ missions: MissionSummary[] }>("/api/missions", 20000);
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const list = data.data?.missions ?? [];

  async function createMission(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await post<{ slug: string }>("/api/manage/missions", {
        title: title.trim(),
        description: description.trim(),
      });
      setCreateOpen(false);
      setTitle("");
      setDescription("");
      toast("success", "Mission created");
      navigate("/admin/missions/" + r.slug);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Could not create mission");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMission(m: MissionSummary) {
    if (
      !window.confirm(
        `Delete mission "${m.title}"? Its problems stay safely in the Problem Bank (hidden from Practice), while mission scores are removed.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await del("/api/manage/missions/" + m.slug);
      toast("success", "Mission deleted");
      await data.reload();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Could not delete mission");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: "1.1rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Build</div>
          <h1>Missions</h1>
          <p>
            Training TPs scored by each student’s best submission per exercise. Create missions here or assign exercises straight from the Problem Bank.
          </p>
        </div>
        <div className="row" style={{ gap: "0.5rem" }}>
          <button onClick={() => navigate("/missions")}>Public view</button>
          <button className="primary" onClick={() => setCreateOpen(true)}>
            <AdminIcon name="plus" /> New mission
          </button>
        </div>
      </div>

      <div className="stat-tiles">
        <Stat label="Total missions" value={list.length} />
        <Stat label="Open sessions" value={list.filter((m) => m.open).length} tone="ok" />
        <Stat label="Assigned exercises" value={list.reduce((n, m) => n + m.problems, 0)} tone="info" />
        <Stat label="Student participations" value={list.reduce((n, m) => n + m.participants, 0)} />
      </div>

      <ErrorBox error={data.error} />

      {data.loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty>
          No missions yet. Click <strong>New mission</strong> above, or select problems in the Problem Bank and assign them to a new mission.
        </Empty>
      ) : (
        <section className="table-card">
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Mission</th>
                  <th style={{ width: 105 }}>State</th>
                  <th style={{ width: 110 }}>Exercises</th>
                  <th style={{ width: 115 }}>Points</th>
                  <th style={{ width: 125 }}>Participants</th>
                  <th style={{ width: 230 }} className="right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.slug} className="row-clickable" onClick={() => navigate("/admin/missions/" + m.slug)}>
                    <td>
                      <div className="cell-primary">
                        <span className="cell-title">{m.title}</span>
                      </div>
                      <div className="cell-secondary">
                        <span className="cell-slug">{m.slug}</span>
                        {m.description && (
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>· {m.description}</span>
                        )}
                      </div>
                    </td>
                    <td>{m.open ? <Badge tone="ok">Open</Badge> : <Badge tone="neutral">Closed</Badge>}</td>
                    <td className="mono">{m.problems}</td>
                    <td className="mono">{fmtPts(m.totalPoints)} pts</td>
                    <td className="mono">{m.participants}</td>
                    <td className="right" onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <a className="btn primary" href={"#/admin/missions/" + m.slug}>
                          Manage
                        </a>
                        <a className="btn" href={"#/missions/" + m.slug}>
                          Board
                        </a>
                        <button type="button" className="danger" disabled={busy} onClick={() => void deleteMission(m)}>
                          <AdminIcon name="trash" size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {createOpen && (
        <Modal title="New mission" onClose={() => setCreateOpen(false)}>
          <form className="stack" onSubmit={createMission}>
            <Field label="Title" hint="e.g. Python — TP3, C Course — Session 2">
              <input
                autoFocus
                required
                maxLength={120}
                placeholder="Python — TP3"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Description (optional)">
              <textarea
                rows={3}
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Goals or instructions shown at the top of the mission…"
              />
            </Field>
            <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
              <button type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy || title.trim().length < 2}>
                {busy ? "Creating…" : "Create mission"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function AdminMissionDetail({ slug }: { slug: string }) {
  const mission = useData<MissionDetail>("/api/missions/" + slug, 15000);
  const bank = useData<BankRow[]>("/api/lab/problems");
  const { busy, run } = useAction();
  const toast = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [weights, setWeights] = useState<Record<string, string>>({});

  if (mission.loading) return <Loading />;
  if (!mission.data) return <ErrorBox error={mission.error} />;

  const m = mission.data;
  const exercises = m.me.problems;
  const bankById = new Map((bank.data ?? []).map((b) => [b.id, b]));

  const saveWeight = (problemId: string, raw: string) => {
    const val = Number(raw);
    if (!Number.isFinite(val) || val <= 0 || val > 1000) {
      toast("error", "Points must be between 0.01 and 1000");
      return;
    }
    void run(async () => {
      await patch("/api/manage/missions/" + slug, { weights: { [problemId]: val } });
      await mission.reload();
    }, "Points updated");
  };

  const removeExercise = (problemId: string, title: string) => {
    if (!window.confirm(`Remove "${title}" from this mission? It stays in your Private Problem Bank.`)) return;
    void run(async () => {
      await del("/api/manage/missions/" + slug + "/problems/" + problemId);
      await Promise.all([mission.reload(), bank.reload()]);
    }, "Removed from mission");
  };

  const deleteMission = () => {
    if (!window.confirm(`Delete mission "${m.title}"? Its problems stay in your Problem Bank and its scoreboard is removed.`)) return;
    void run(async () => {
      await del("/api/manage/missions/" + slug);
      navigate("/admin/missions");
    }, "Mission deleted");
  };

  return (
    <div className="stack" style={{ gap: "1.1rem" }}>
      <div>
        <a href="#/admin/missions" className="btn small ghost" style={{ paddingLeft: 0 }}>
          <AdminIcon name="arrowLeft" /> Back to Missions
        </a>
      </div>

      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="row" style={{ gap: "0.5rem", marginBottom: "0.25rem" }}>
            <span className="eyebrow">Mission</span>
            {m.open ? <Badge tone="ok">Open</Badge> : <Badge tone="neutral">Closed</Badge>}
          </div>
          <h1>{m.title}</h1>
          {m.description && <p>{m.description}</p>}
        </div>

        <div className="row" style={{ gap: "0.45rem" }}>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await patch("/api/manage/missions/" + slug, { open: !m.open });
                await mission.reload();
              }, m.open ? "Mission closed" : "Mission reopened")
            }
          >
            {m.open ? "Close submissions" : "Reopen mission"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Start a fresh session window now? Submissions made before now will stop counting on the scoreboard.")) return;
              void run(async () => {
                await patch("/api/manage/missions/" + slug, { restart: true });
                await mission.reload();
              }, "Session window restarted");
            }}
          >
            Restart session
          </button>
          <button type="button" onClick={() => setEditOpen(true)}>
            <AdminIcon name="edit" /> Edit info
          </button>
          <a className="btn" href={"#/missions/" + slug}>
            Public board
          </a>
          <button type="button" className="primary" onClick={() => setAddOpen(true)}>
            <AdminIcon name="plus" /> Add problems
          </button>
        </div>
      </div>

      <div className="stat-tiles">
        <Stat label="Exercises" value={exercises.length} />
        <Stat label="Total points" value={fmtPts(m.totalPoints)} tone="info" />
        <Stat label="Participants" value={m.participants} tone="ok" />
      </div>

      {exercises.length === 0 ? (
        <Empty>
          This mission has no exercises yet. Click <strong>Add problems</strong> to pick ready exercises from your Problem Bank.
        </Empty>
      ) : (
        <section className="table-card">
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 52 }}>#</th>
                  <th>Exercise</th>
                  <th style={{ width: 105 }}>Level</th>
                  <th style={{ width: 180 }}>Points</th>
                  <th style={{ width: 205 }} className="right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {exercises.map((ex, idx) => {
                  const meta = bankById.get(ex.problemId);
                  const draftWeight = weights[ex.problemId] ?? String(ex.weight);
                  const changed = Number(draftWeight) !== ex.weight;
                  return (
                    <tr key={ex.problemId}>
                      <td className="mono muted">{idx + 1}</td>
                      <td>
                        <div className="cell-primary">
                          <a href={"#/admin/problems/" + ex.version} className="cell-title">
                            {ex.title}
                          </a>
                        </div>
                        {meta && (
                          <div className="cell-secondary">
                            <span className="cell-slug">{meta.slug}</span>
                          </div>
                        )}
                      </td>
                      <td>
                        <DifficultyPill value={meta?.difficulty ?? "MEDIUM"} />
                      </td>
                      <td>
                        <div className="row" style={{ gap: "0.35rem", flexWrap: "nowrap" }}>
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={draftWeight}
                            onChange={(e) => setWeights({ ...weights, [ex.problemId]: e.target.value })}
                            style={{ width: 82, height: 30, padding: "0 0.45rem", fontSize: "0.84rem" }}
                          />
                          {changed && (
                            <button
                              type="button"
                              className="primary small"
                              disabled={busy}
                              style={{ height: 30, padding: "0 0.55rem" }}
                              onClick={() => saveWeight(ex.problemId, draftWeight)}
                            >
                              Save
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="right">
                        <div className="row-actions">
                          <button type="button" onClick={() => setPreviewId(ex.version)}>
                            Preview
                          </button>
                          <a className="btn" href={"#/admin/problems/" + ex.version}>
                            Edit
                          </a>
                          <button
                            type="button"
                            className="danger"
                            disabled={busy}
                            onClick={() => removeExercise(ex.problemId, ex.title)}
                          >
                            Remove
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

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="danger small" disabled={busy} onClick={deleteMission}>
          <AdminIcon name="trash" /> Delete mission
        </button>
      </div>

      {editOpen && (
        <EditMissionModal
          title={m.title}
          description={m.description}
          onClose={() => setEditOpen(false)}
          onSave={(nextTitle, nextDesc) =>
            run(async () => {
              await patch("/api/manage/missions/" + slug, { title: nextTitle, description: nextDesc });
              setEditOpen(false);
              await mission.reload();
            }, "Mission updated")
          }
        />
      )}

      {addOpen && (
        <MissionBankPickerModal
          missionSlug={slug}
          missionTitle={m.title}
          bank={bank.data ?? []}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            void mission.reload();
            void bank.reload();
          }}
        />
      )}

      {previewId && <ProblemPreviewModal versionId={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

function EditMissionModal({
  title,
  description,
  onSave,
  onClose,
}: {
  title: string;
  description: string;
  onSave: (title: string, description: string) => void;
  onClose: () => void;
}) {
  const [t, setT] = useState(title);
  const [d, setD] = useState(description);
  return (
    <Modal title="Edit mission" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (t.trim().length >= 2) onSave(t.trim(), d.trim());
        }}
      >
        <Field label="Title">
          <input required maxLength={120} value={t} onChange={(e) => setT(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea rows={3} maxLength={4000} value={d} onChange={(e) => setD(e.target.value)} />
        </Field>
        <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={t.trim().length < 2}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MissionBankPickerModal({
  missionSlug,
  missionTitle,
  bank,
  onDone,
  onClose,
}: {
  missionSlug: string;
  missionTitle: string;
  bank: BankRow[];
  onDone: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [diff, setDiff] = useState<"" | "EASY" | "MEDIUM" | "HARD">("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [weight, setWeight] = useState(10);
  const [busy, setBusy] = useState(false);

  const available = useMemo(() => {
    const query = q.trim().toLowerCase();
    return bank.filter((p) => {
      if (!isReadyToAssign(p)) return false;
      if (p.mission_slug === missionSlug) return false;
      if (diff && (p.difficulty ?? "MEDIUM") !== diff) return false;
      if (query && !(p.title + " " + p.slug + " " + (p.folder ?? "")).toLowerCase().includes(query)) return false;
      return true;
    });
  }, [bank, missionSlug, diff, q]);

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
        surface: "MISSION",
        action: "add",
        missionSlug,
        weight,
      });
      toast("success", `Added ${picked.size} exercise${picked.size === 1 ? "" : "s"} to ${missionTitle}`);
      onDone();
      onClose();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to add problems");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" role="dialog" aria-modal="true" aria-label="Add exercises from Problem Bank">
        <div className="row-between" style={{ marginBottom: "0.85rem" }}>
          <h2 style={{ margin: 0 }}>Add exercises to {missionTitle}</h2>
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
            <div className="row" style={{ gap: "0.35rem", marginLeft: "auto" }}>
              <span className="small muted">Points each:</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={weight}
                onChange={(e) => setWeight(Math.max(1, Math.min(1000, Number(e.target.value) || 10)))}
                style={{ width: 76, height: 34, padding: "0 0.5rem" }}
              />
            </div>
          </div>

          {available.length === 0 ? (
            <Empty>No matching ready problems in your Problem Bank.</Empty>
          ) : (
            <div className="collection-list" style={{ maxHeight: 340 }}>
              {available.map((p) => (
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
                      {p.in_problem_set && <span className="surface-pill practice">In Practice</span>}
                      {p.td_number != null && <span className="surface-pill td">TD {p.td_number}</span>}
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
                {busy ? "Adding…" : `Add ${picked.size || ""} to mission`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
