import { useEffect, useMemo, useState } from "react";
import { patch, post } from "../../api";
import { navigate, useAction, useData, useToast } from "../../app";
import { AdminIcon, type AdminIconName } from "../../components/AdminIcons";
import { DifficultyPill } from "../Practice";
import { describe, parseSignature } from "../../lib/functionMode";
import { STANDARD_TOPICS, topicLabel } from "../../lib/topics";
import { Empty, ErrorBox, Field, LANGUAGE_NAMES, Loading, Markdown, queueProblemsForContest } from "../../ui";

export type BankRow = {
  id: string;
  slug: string;
  version_id: string;
  title: string;
  version_number: number;
  status: string;
  validation_status?: string | null;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  tags?: string[];
  folder?: string | null;
  in_problem_set?: boolean;
  td_number?: number | null;
  mission_slug?: string | null;
  mission_title?: string | null;
  in_duel_pool?: boolean;
  contest_count?: number;
  contest_titles?: string | null;
  deleted_at: string | null;
};

export type AssignSurface = "PRACTICE" | "TD" | "MISSION" | "DUEL" | "CONTEST" | "COLLECTION";

const TD_THEMES: Record<number, string> = {
  1: "Operateurs, conditions et E/S",
  2: "Boucles",
  3: "Tableaux et matrices",
  4: "Chaines de caracteres",
  5: "Pointeurs, fonctions et allocation",
  6: "Fichiers",
};

export function isReadyToAssign(p: BankRow) {
  if (p.status === "APPROVED" || p.status === "PUBLISHED") return true;
  if (p.status === "READY_FOR_REVIEW" && p.validation_status === "PASSED") return true;
  return false;
}

export function isPubliclyVisible(p: BankRow) {
  return Boolean(p.in_problem_set || p.td_number != null || p.mission_slug);
}

export function isUnassigned(p: BankRow) {
  return !p.in_problem_set && p.td_number == null && !p.mission_slug && !p.in_duel_pool && !(p.contest_count && p.contest_count > 0);
}

function DialogShell({
  title,
  size = "lg",
  onClose,
  children,
}: {
  title: string;
  size?: "md" | "lg" | "xl";
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const cls = size === "xl" ? "modal modal-xl" : size === "lg" ? "modal modal-lg" : "modal";
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cls} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row-between" style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost small" onClick={onClose} aria-label="Close">
            <AdminIcon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type EditableCompetition = {
  id: string;
  title: string;
  slug: string;
  status: string;
  contest_format?: "STANDARD" | "BASIC" | "WARMUP";
};

type MissionSummary = {
  slug: string;
  title: string;
  open: boolean;
  problems: number;
};

const DESTINATIONS: { key: AssignSurface; label: string; sub: string; icon: AdminIconName }[] = [
  { key: "PRACTICE", label: "Public Practice", sub: "General problem set for all users", icon: "practice" },
  { key: "TD", label: "Academic TD", sub: "Course exercise in TD 1..N", icon: "layers" },
  { key: "MISSION", label: "Mission (TP)", sub: "Scored training session with points", icon: "missions" },
  { key: "DUEL", label: "Duel Pool", sub: "Private pool for blitz rooms", icon: "duels" },
  { key: "CONTEST", label: "Contest", sub: "New contest or draft competition", icon: "contests" },
  { key: "COLLECTION", label: "Collection", sub: "Private folder in Problem Bank", icon: "folder" },
];

export function AssignModal({
  problems,
  initialSurface = "PRACTICE",
  onDone,
  onClose,
}: {
  problems: BankRow[];
  initialSurface?: AssignSurface;
  onDone: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [surface, setSurface] = useState<AssignSurface>(initialSurface);
  const [busy, setBusy] = useState(false);

  // Surface-specific options
  const [tdNumber, setTdNumber] = useState(1);
  const [missionMode, setMissionMode] = useState<"existing" | "new">("existing");
  const [missionSlug, setMissionSlug] = useState("");
  const [missionTitle, setMissionTitle] = useState("");
  const [missionDescription, setMissionDescription] = useState("");
  const [missionWeight, setMissionWeight] = useState(10);

  const [contestMode, setContestMode] = useState<"new" | "existing">("new");
  const [contestFormat, setContestFormat] = useState<"BASIC" | "WARMUP" | "STANDARD">("BASIC");
  const [competitionId, setCompetitionId] = useState("");

  const [collectionName, setCollectionName] = useState(problems.length === 1 ? problems[0].folder ?? "" : "");

  const missionsData = useData<{ missions: MissionSummary[] }>("/api/missions");
  const contestsData = useData<EditableCompetition[]>("/api/manage/competitions");
  const collectionsData = useData<{ collections: { name: string; problem_count: number }[] }>("/api/lab/problems/collections");

  const missions = missionsData.data?.missions ?? [];
  const editableContests = useMemo(
    () => (contestsData.data ?? []).filter((c) => ["DRAFT", "INTERNAL_TESTING", "READY", "SCHEDULED"].includes(c.status)),
    [contestsData.data],
  );
  const collections = collectionsData.data?.collections ?? [];

  useEffect(() => {
    if (missions.length > 0 && !missionSlug) setMissionSlug(missions[0].slug);
    if (!missionsData.loading && missions.length === 0) setMissionMode("new");
  }, [missions, missionSlug, missionsData.loading]);

  useEffect(() => {
    if (editableContests.length > 0 && !competitionId) setCompetitionId(editableContests[0].id);
  }, [editableContests, competitionId]);

  const readyRows = useMemo(() => problems.filter(isReadyToAssign), [problems]);
  const unreadyCount = problems.length - readyRows.length;
  const leakRows = useMemo(() => readyRows.filter(isPubliclyVisible), [readyRows]);

  const hasPractice = problems.some((p) => p.in_problem_set);
  const hasTd = problems.some((p) => p.td_number != null);
  const hasMission = problems.some((p) => Boolean(p.mission_slug));
  const hasDuel = problems.some((p) => p.in_duel_pool);
  const hasCollection = problems.some((p) => Boolean(p.folder));

  const canSubmitAdd = (() => {
    if (surface === "COLLECTION") return Boolean(collectionName.trim());
    if (readyRows.length === 0) return false;
    if (surface === "MISSION") {
      return missionMode === "existing" ? Boolean(missionSlug) : missionTitle.trim().length >= 2;
    }
    if (surface === "CONTEST") {
      return contestMode === "new" || Boolean(competitionId);
    }
    return true;
  })();

  async function submit(action: "add" | "remove") {
    if (action === "add" && surface === "CONTEST" && contestMode === "new") {
      setBusy(true);
      try {
        const needApprove = readyRows.filter((p) => p.status === "READY_FOR_REVIEW").map((p) => p.version_id);
        if (needApprove.length > 0) {
          await post("/api/lab/problems/bulk-approve", {
            versionIds: needApprove,
            reason: "Approved when queueing for a new contest",
          });
        }
        queueProblemsForContest(
          readyRows.map((p) => p.version_id),
          contestFormat,
        );
        onClose();
        navigate("/admin/contests/new");
      } catch (e) {
        toast("error", e instanceof Error ? e.message : "Could not prepare contest problems");
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const targetIds =
        surface === "COLLECTION" || action === "remove"
          ? problems.map((p) => p.version_id)
          : readyRows.map((p) => p.version_id);

      await post("/api/lab/problems/assign", {
        versionIds: targetIds,
        surface,
        action,
        ...(surface === "TD" ? { tdNumber } : {}),
        ...(surface === "MISSION"
          ? missionMode === "existing"
            ? { missionSlug, weight: missionWeight }
            : { missionTitle: missionTitle.trim(), missionDescription: missionDescription.trim(), weight: missionWeight }
          : {}),
        ...(surface === "CONTEST" ? { competitionId } : {}),
        ...(surface === "COLLECTION" ? { collection: collectionName.trim() } : {}),
      });

      const label =
        action === "remove"
          ? `Removed from ${surface.toLowerCase()}`
          : surface === "PRACTICE"
          ? "Published to Public Practice"
          : surface === "TD"
          ? `Assigned to TD ${tdNumber}`
          : surface === "MISSION"
          ? "Assigned to Mission"
          : surface === "DUEL"
          ? "Added to Duel Pool"
          : surface === "CONTEST"
          ? "Added to Contest"
          : `Moved to "${collectionName.trim()}"`;

      toast("success", label);
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  }

  const title =
    problems.length === 1 ? `Assign "${problems[0].title}"` : `Assign ${problems.length} selected problems`;

  return (
    <DialogShell title={title} size="lg" onClose={onClose}>
      <div className="stack" style={{ gap: "1rem" }}>
        <div className="dest-grid" role="tablist" aria-label="Destination">
          {DESTINATIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={surface === d.key}
              className={"dest-tile" + (surface === d.key ? " active" : "")}
              onClick={() => setSurface(d.key)}
            >
              <span className="dest-head">
                <AdminIcon name={d.icon} />
                {d.label}
              </span>
              <span className="dest-sub">{d.sub}</span>
            </button>
          ))}
        </div>

        {surface !== "COLLECTION" && unreadyCount > 0 && (
          <div className={"notice small " + (readyRows.length === 0 ? "bad" : "warn")}>
            {readyRows.length === 0 ? (
              <>
                <strong>Validation required:</strong> {problems.length === 1 ? "This problem is" : "All selected problems are"}{" "}
                still in draft or testing. Validate {problems.length === 1 ? "it" : "them"} before assigning to a live surface
                (you can still organize drafts into a private <strong>Collection</strong>).
              </>
            ) : (
              <>
                <strong>{unreadyCount}</strong> of {problems.length} selected problem{unreadyCount === 1 ? " is" : "s are"} still
                in draft/testing and will be skipped. The remaining <strong>{readyRows.length}</strong> ready problem
                {readyRows.length === 1 ? "" : "s"} will be assigned.
              </>
            )}
          </div>
        )}

        {(surface === "DUEL" || surface === "CONTEST") && leakRows.length > 0 && (
          <div className="notice warn small" style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start" }}>
            <AdminIcon name="warning" size={16} />
            <div>
              <strong>Visibility warning:</strong> {leakRows.length} selected problem{leakRows.length === 1 ? " is" : "s are"}{" "}
              already visible to students in Practice, a TD, or a Mission (
              {leakRows
                .slice(0, 3)
                .map((p) => p.title)
                .join(", ")}
              {leakRows.length > 3 ? "…" : ""}). Participants may have already solved them.
            </div>
          </div>
        )}

        <div className="card-flat stack" style={{ gap: "0.75rem" }}>
          {surface === "PRACTICE" && (
            <p className="small" style={{ margin: 0 }}>
              Publishes {readyRows.length || problems.length} problem{(readyRows.length || problems.length) === 1 ? "" : "s"} to
              the general <strong>Public Practice</strong> catalog so any signed-in student can practice and filter by topic.
              (If a problem was in a TD or Mission, it moves into general Practice.)
            </p>
          )}

          {surface === "TD" && (
            <div className="grid grid-2" style={{ gap: "0.75rem", alignItems: "end" }}>
              <Field label="TD session number" hint="Grouped in course order on the Academic TD page; kept out of general Practice.">
                <select value={tdNumber} onChange={(e) => setTdNumber(Number(e.target.value))}>
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      TD {n}
                      {TD_THEMES[n] ? ` — ${TD_THEMES[n]}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Or custom TD (1–99)">
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={tdNumber}
                  onChange={(e) => setTdNumber(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                />
              </Field>
            </div>
          )}

          {surface === "MISSION" && (
            <div className="stack" style={{ gap: "0.75rem" }}>
              {missions.length > 0 && (
                <div className="seg-group" style={{ alignSelf: "flex-start" }}>
                  <button
                    type="button"
                    className={missionMode === "existing" ? "active" : ""}
                    onClick={() => setMissionMode("existing")}
                  >
                    Existing mission ({missions.length})
                  </button>
                  <button
                    type="button"
                    className={missionMode === "new" ? "active" : ""}
                    onClick={() => setMissionMode("new")}
                  >
                    + Create new mission
                  </button>
                </div>
              )}

              {missionMode === "existing" && missions.length > 0 ? (
                <div className="grid grid-2" style={{ gap: "0.75rem" }}>
                  <Field label="Mission">
                    <select value={missionSlug} onChange={(e) => setMissionSlug(e.target.value)}>
                      {missions.map((m) => (
                        <option key={m.slug} value={m.slug}>
                          {m.title} ({m.problems} ex. · {m.open ? "Open" : "Closed"})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Points per problem">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={missionWeight}
                      onChange={(e) => setMissionWeight(Math.max(1, Math.min(1000, Number(e.target.value) || 10)))}
                    />
                  </Field>
                </div>
              ) : (
                <div className="grid grid-2" style={{ gap: "0.75rem" }}>
                  <Field label="New mission title" hint="Kept off the general Practice list; scored by best submission.">
                    <input
                      placeholder="e.g. Python — TP3"
                      maxLength={120}
                      value={missionTitle}
                      onChange={(e) => setMissionTitle(e.target.value)}
                    />
                  </Field>
                  <Field label="Points per problem">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={missionWeight}
                      onChange={(e) => setMissionWeight(Math.max(1, Math.min(1000, Number(e.target.value) || 10)))}
                    />
                  </Field>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <Field label="Description (optional)">
                      <input
                        placeholder="Short instructions for students…"
                        maxLength={400}
                        value={missionDescription}
                        onChange={(e) => setMissionDescription(e.target.value)}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          )}

          {surface === "DUEL" && (
            <p className="small" style={{ margin: 0 }}>
              Adds {readyRows.length || problems.length} problem{(readyRows.length || problems.length) === 1 ? "" : "s"} to the
              private <strong>Duel Pool</strong>. Duel problems stay hidden from Practice so players see them for the first time
              during a blitz round.
            </p>
          )}

          {surface === "CONTEST" && (
            <div className="stack" style={{ gap: "0.75rem" }}>
              <div className="seg-group" style={{ alignSelf: "flex-start" }}>
                <button
                  type="button"
                  className={contestMode === "new" ? "active" : ""}
                  onClick={() => setContestMode("new")}
                >
                  Create new contest
                </button>
                <button
                  type="button"
                  disabled={editableContests.length === 0}
                  className={contestMode === "existing" ? "active" : ""}
                  onClick={() => setContestMode("existing")}
                >
                  Add to existing ({editableContests.length})
                </button>
              </div>

              {contestMode === "new" ? (
                <Field label="Contest preset" hint="Opens the Contest Wizard with these problems pre-loaded.">
                  <select
                    value={contestFormat}
                    onChange={(e) => setContestFormat(e.target.value as "BASIC" | "WARMUP" | "STANDARD")}
                  >
                    <option value="BASIC">Basic (90 min · ICPC · unrated)</option>
                    <option value="WARMUP">Warmup (multi-day · IOI partial points)</option>
                    <option value="STANDARD">Normal Contest (3h · ICPC · rated)</option>
                  </select>
                </Field>
              ) : (
                <Field label="Target contest" hint="Only contests that have not started yet can receive new problems.">
                  <select value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
                    {editableContests.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} ({c.status.toLowerCase().replace(/_/g, " ")})
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          )}

          {surface === "COLLECTION" && (
            <div className="stack" style={{ gap: "0.6rem" }}>
              <Field
                label="Collection name"
                hint="Private organizer group inside Problem Bank (use / for nested collections, e.g. C Course/Week 1)."
              >
                <input
                  list="assign-modal-collections"
                  placeholder="e.g. Spring Cup, Warmup Week 1, C Course…"
                  maxLength={120}
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                />
                <datalist id="assign-modal-collections">
                  {collections.map((c) => (
                    <option key={c.name} value={c.name} />
                  ))}
                </datalist>
              </Field>
              {collections.length > 0 && (
                <div className="chips">
                  {collections.slice(0, 10).map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      className={"tag-chip small" + (collectionName === c.name ? " active" : "")}
                      onClick={() => setCollectionName(c.name)}
                    >
                      {c.name} ({c.problem_count})
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="row-between" style={{ paddingTop: "0.25rem" }}>
          <div>
            {surface === "PRACTICE" && hasPractice && (
              <button type="button" className="danger small" disabled={busy} onClick={() => void submit("remove")}>
                Remove from Practice
              </button>
            )}
            {surface === "TD" && hasTd && (
              <button type="button" className="danger small" disabled={busy} onClick={() => void submit("remove")}>
                Remove from TD
              </button>
            )}
            {surface === "MISSION" && hasMission && (
              <button type="button" className="danger small" disabled={busy} onClick={() => void submit("remove")}>
                Remove from Mission
              </button>
            )}
            {surface === "DUEL" && hasDuel && (
              <button type="button" className="danger small" disabled={busy} onClick={() => void submit("remove")}>
                Remove from Duel Pool
              </button>
            )}
            {surface === "COLLECTION" && hasCollection && (
              <button type="button" className="small" disabled={busy} onClick={() => void submit("remove")}>
                Remove from collection
              </button>
            )}
          </div>
          <div className="row" style={{ gap: "0.5rem" }}>
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="primary" disabled={busy || !canSubmitAdd} onClick={() => void submit("add")}>
              {busy
                ? "Saving…"
                : surface === "CONTEST" && contestMode === "new"
                ? `Continue to Contest Wizard (${readyRows.length})`
                : surface === "COLLECTION"
                ? "Move to collection"
                : `Confirm assignment (${readyRows.length})`}
            </button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

type PreviewDetail = {
  id: string;
  title: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  status: string;
  version_number: number;
  statement_md: string;
  input_format_md: string;
  output_format_md: string;
  constraints_md: string;
  explanation_md: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  function_signature: string | null;
  tests: { id: string; input_data: string; expected_output: string; is_sample: boolean }[];
  languages: string[];
};

export function ProblemPreviewModal({
  versionId,
  onClose,
  onAssign,
}: {
  versionId: string;
  onClose: () => void;
  onAssign?: () => void;
}) {
  const detail = useData<PreviewDetail>("/api/lab/problems/" + versionId);
  const p = detail.data;
  const sig = p ? parseSignature(p.function_signature) : null;
  const samples = useMemo(() => (p?.tests ?? []).filter((t) => t.is_sample), [p?.tests]);
  const hiddenCount = (p?.tests.length ?? 0) - samples.length;

  return (
    <DialogShell title={p ? `${p.title} (Student Preview)` : "Student Preview"} size="xl" onClose={onClose}>
      {detail.loading ? (
        <Loading />
      ) : !p ? (
        <ErrorBox error={detail.error} />
      ) : (
        <div className="stack" style={{ gap: "1rem" }}>
          <div className="preview-meta-bar">
            <DifficultyPill value={p.difficulty ?? "MEDIUM"} />
            <span>
              <strong>Time:</strong> {p.time_limit_ms} ms
            </span>
            <span>
              <strong>Memory:</strong> {p.memory_limit_mb} MB
            </span>
            <span>
              <strong>Tests:</strong> {samples.length} sample · {hiddenCount} hidden
            </span>
            <span className="muted">
              <strong>Languages:</strong>{" "}
              {p.languages.length > 0 ? p.languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(", ") : "None"}
            </span>
          </div>

          <div className="statement" style={{ maxHeight: "56vh", overflow: "auto", paddingRight: "0.35rem" }}>
            <Markdown text={p.statement_md} />

            {sig ? (
              <>
                <h3>Function Signature</h3>
                <pre className="card-flat small mono">{describe(sig)}</pre>
              </>
            ) : (
              <>
                {p.input_format_md?.trim() && (
                  <>
                    <h3>Input</h3>
                    <Markdown text={p.input_format_md} />
                  </>
                )}
                {p.output_format_md?.trim() && (
                  <>
                    <h3>Output</h3>
                    <Markdown text={p.output_format_md} />
                  </>
                )}
              </>
            )}

            {p.constraints_md?.trim() && (
              <>
                <h3>Constraints</h3>
                <Markdown text={p.constraints_md} />
              </>
            )}

            {samples.length > 0 && (
              <>
                <h3>Examples</h3>
                {samples.map((s, idx) => (
                  <div key={s.id || idx} className="sample">
                    <div>
                      <div className="small muted">Input {idx + 1}</div>
                      <pre>{s.input_data}</pre>
                    </div>
                    <div>
                      <div className="small muted">Output {idx + 1}</div>
                      <pre>{s.expected_output}</pre>
                    </div>
                  </div>
                ))}
              </>
            )}

            {p.explanation_md?.trim() && (
              <>
                <h3>Notes</h3>
                <Markdown text={p.explanation_md} />
              </>
            )}
          </div>

          <div className="row-between" style={{ borderTop: "1px solid var(--line)", paddingTop: "0.75rem" }}>
            <a
              className="btn small"
              href={"#/admin/problems/" + p.id}
              onClick={() => onClose()}
            >
              <AdminIcon name="edit" /> Open in Problem Editor
            </a>
            <div className="row" style={{ gap: "0.5rem" }}>
              {onAssign && (
                <button
                  type="button"
                  className="primary small"
                  onClick={() => {
                    onClose();
                    onAssign();
                  }}
                >
                  Assign problem…
                </button>
              )}
              <button type="button" className="small" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogShell>
  );
}

export function CollectionsModal({
  onChanged,
  onSelectCollection,
  onClose,
}: {
  onChanged: () => void;
  onSelectCollection?: (name: string) => void;
  onClose: () => void;
}) {
  const data = useData<{ collections: { name: string; problem_count: number }[] }>("/api/lab/problems/collections");
  const { busy, run } = useAction();
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const collections = data.data?.collections ?? [];

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newName.trim();
    if (!clean) return;
    run(async () => {
      const res = await post<{ name: string }>("/api/lab/problems/collections", { name: clean });
      setNewName("");
      await data.reload();
      onChanged();
      if (onSelectCollection) onSelectCollection(res.name);
    }, `Collection "${clean}" created`);
  };

  const saveRename = (from: string, to: string) =>
    run(async () => {
      await patch("/api/lab/problems/collections", { from, to });
      setRenaming(null);
      await data.reload();
      onChanged();
    }, "Collection renamed");

  const remove = (name: string, count: number) => {
    if (!window.confirm(`Delete collection "${name}"? ${count > 0 ? `Its ${count} problems will stay safely in the Problem Bank (uncollected).` : ""}`)) {
      return;
    }
    run(async () => {
      await post("/api/lab/problems/collections/delete", { name });
      await data.reload();
      onChanged();
    }, `Collection "${name}" deleted`);
  };

  return (
    <DialogShell title="Manage Collections" size="md" onClose={onClose}>
      <div className="stack" style={{ gap: "0.9rem" }}>
        <p className="small muted" style={{ margin: 0 }}>
          Collections are private organizer groups inside your Problem Bank (never shown to students). Use <code>/</code> for nested paths like <code>C Course/Week 1</code>.
        </p>

        <form className="row" style={{ gap: "0.5rem", flexWrap: "nowrap" }} onSubmit={create}>
          <input
            placeholder="New collection name…"
            maxLength={120}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="primary" disabled={busy || !newName.trim()} style={{ flexShrink: 0 }}>
            <AdminIcon name="plus" /> Create
          </button>
        </form>

        {data.loading ? (
          <Loading />
        ) : collections.length === 0 ? (
          <Empty>No collections yet. Create one above to group your problems.</Empty>
        ) : (
          <div className="collection-list">
            {collections.map((c) => (
              <div key={c.name} className="collection-row">
                {renaming?.from === c.name ? (
                  <div className="row" style={{ flex: 1, gap: "0.4rem", flexWrap: "nowrap" }}>
                    <input
                      autoFocus
                      value={renaming.to}
                      maxLength={120}
                      onChange={(e) => setRenaming({ from: c.name, to: e.target.value })}
                      style={{ height: 30, padding: "0 0.5rem" }}
                    />
                    <button
                      type="button"
                      className="primary small"
                      disabled={busy || !renaming.to.trim()}
                      onClick={() => void saveRename(c.name, renaming.to.trim())}
                    >
                      Save
                    </button>
                    <button type="button" className="small" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="row" style={{ gap: "0.5rem", minWidth: 0 }}>
                      <AdminIcon name="folder" />
                      <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</strong>
                      <span className="count">{c.problem_count}</span>
                    </div>
                    <div className="row-actions">
                      {onSelectCollection && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectCollection(c.name);
                            onClose();
                          }}
                        >
                          Filter
                        </button>
                      )}
                      <button type="button" onClick={() => setRenaming({ from: c.name, to: c.name })}>
                        Rename
                      </button>
                      <button type="button" className="danger" disabled={busy} onClick={() => remove(c.name, c.problem_count)}>
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DialogShell>
  );
}

export function BulkTagsModal({
  problems,
  onDone,
  onClose,
}: {
  problems: BankRow[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { busy, run } = useAction();
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    problems.length === 1 ? [...(problems[0].tags ?? [])] : [],
  );
  const [custom, setCustom] = useState("");
  const [append, setAppend] = useState(problems.length > 1);

  const toggle = (tag: string) => {
    setSelectedTags((old) =>
      old.includes(tag) ? old.filter((x) => x !== tag) : old.length < 8 ? [...old, tag] : old,
    );
  };

  const addCustom = () => {
    const clean = custom.trim().toLowerCase().replace(/\s+/g, " ");
    if (clean && !selectedTags.includes(clean) && selectedTags.length < 8) {
      setSelectedTags([...selectedTags, clean]);
    }
    setCustom("");
  };

  const save = () =>
    run(async () => {
      await post("/api/lab/problems/bulk-tags", {
        ids: problems.map((p) => p.id),
        tags: selectedTags,
        append,
      });
      onDone();
      onClose();
    }, "Topics updated");

  return (
    <DialogShell
      title={problems.length === 1 ? `Topics for "${problems[0].title}"` : `Edit topics (${problems.length} problems)`}
      size="md"
      onClose={onClose}
    >
      <div className="stack" style={{ gap: "0.9rem" }}>
        {problems.length > 1 && (
          <div className="seg-group" style={{ alignSelf: "flex-start" }}>
            <button type="button" className={append ? "active" : ""} onClick={() => setAppend(true)}>
              Add to existing topics
            </button>
            <button type="button" className={!append ? "active" : ""} onClick={() => setAppend(false)}>
              Replace topics
            </button>
          </div>
        )}

        <div className="chips">
          {STANDARD_TOPICS.map((t) => (
            <button
              key={t}
              type="button"
              className={"tag-chip" + (selectedTags.includes(t) ? " active" : "")}
              onClick={() => toggle(t)}
            >
              {topicLabel(t)}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: "0.45rem", flexWrap: "nowrap" }}>
          <input
            placeholder="Custom topic (max 8 total)…"
            maxLength={24}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
          />
          <button type="button" onClick={addCustom} disabled={!custom.trim() || selectedTags.length >= 8}>
            Add
          </button>
        </div>

        {selectedTags.length > 0 && (
          <div className="chips">
            {selectedTags.map((t) => (
              <span key={t} className="tag-chip active small">
                {topicLabel(t)}
                <button
                  type="button"
                  className="ghost small"
                  style={{ padding: "0 0.2rem", color: "inherit" }}
                  onClick={() => toggle(t)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save topics"}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
