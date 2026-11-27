import { useEffect, useMemo, useRef, useState } from "react";
import { get, post } from "../../api";
import { navigate, useAuth, useData } from "../../app";
import { AdminIcon } from "../../components/AdminIcons";
import { Badge, ErrorBox, Field, LANGUAGE_NAMES } from "../../ui";
import { DifficultyPill } from "../Practice";
import { FUNCTION_LANGUAGES } from "../../lib/functionMode";
import { suggestTopics, topicLabel } from "../../lib/topics";
import {
  importProblem,
  readProblemBankFile,
  type BankProblem,
  type ImportMode,
  type ImportTransport,
  type ImportUpdate,
} from "../../lib/problemImport";

type Row = {
  problem: BankProblem;
  selected: boolean;
  state: "ready" | "running" | "done" | "skipped" | "error";
  message: string;
  versionId?: string;
  ownedAttempt?: boolean;
};

const transport: ImportTransport = {
  importProblem: (problem) => post("/api/lab/problems/import", problem),
  status: (id) => get("/api/lab/problems/" + id + "/status"),
  action: (id, action, body) => post("/api/lab/problems/" + id + "/" + action, body ?? {}),
  wait: () => new Promise((resolve) => setTimeout(resolve, 2000)),
};

/** Safe two-step bulk importer: everything lands in the Private Problem Bank first. */
export default function ProblemImport({ duel = false }: { duel?: boolean }) {
  const { organizer } = useAuth();
  const serverLangs = useData<{ code: string; enabled: boolean }[]>("/api/languages");
  const existingProblems = useData<{ slug: string; version_id: string }[]>("/api/lab/problems");
  const collectionsData = useData<{ collections: { name: string; problem_count: number }[] }>("/api/lab/problems/collections");

  const enabledLangs = (serverLangs.data ?? []).filter((l) => l.enabled).map((l) => l.code);
  const existingSlugs = useMemo(
    () => new Set((existingProblems.data ?? []).map((p) => p.slug)),
    [existingProblems.data],
  );
  const collections = collectionsData.data?.collections ?? [];

  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<ImportMode>(organizer ? (duel ? "duel" : "approve") : "validate");
  const [collection, setCollection] = useState("");
  const [autoTag, setAutoTag] = useState(true);
  const [useAllServerLangs, setUseAllServerLangs] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);

  const activeCollection = collection.trim() || undefined;

  const tagsFor = (problem: BankProblem) => {
    const base = problem.tags?.length
      ? problem.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
      : autoTag
      ? suggestTopics(problem)
      : [];
    return [...new Set(base)].slice(0, 8);
  };

  const langsFor = (problem: BankProblem) => {
    if (!useAllServerLangs || enabledLangs.length === 0) return problem.languages;
    const pool = problem.functionSignature
      ? enabledLangs.filter((l) => FUNCTION_LANGUAGES.includes(l))
      : enabledLangs;
    const merged = [...new Set([...pool, problem.reference.language])].filter((l) => enabledLangs.includes(l));
    return merged.length > 0 ? merged : problem.languages;
  };

  const prepared = (problem: BankProblem): BankProblem => {
    const { td: _td, mission: _mission, contestFlag: _flag, ...clean } = problem;
    const tags = tagsFor(problem);
    const languages = langsFor(problem);
    const targetFolder = activeCollection ?? problem.folder;
    return {
      ...clean,
      languages,
      tags,
      ...(targetFolder ? { folder: targetFolder } : {}),
    };
  };

  const stop = useRef(false);
  const active = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const update = (slug: string, change: Partial<Row>) => {
    if (mounted.current) {
      setRows((old) => old.map((r) => (r.problem.slug === slug ? { ...r, ...change } : r)));
    }
  };

  async function read(file: File) {
    if (active.current) return;
    setReading(true);
    setError(null);
    setRows([]);
    setFileName(file.name);
    try {
      const problems = await readProblemBankFile(file);
      if (mounted.current) {
        setRows(
          problems.map((problem) => ({
            problem,
            selected: true,
            state: "ready",
            message: existingSlugs.has(problem.slug) ? "Already in bank (will update metadata only)" : "Ready to import",
          })),
        );
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e : new Error("Could not read this bank"));
    } finally {
      if (mounted.current) setReading(false);
    }
  }

  async function runImport() {
    if (active.current || reading) return;
    active.current = true;
    stop.current = false;
    setBusy(true);
    setError(null);
    try {
      for (const row of rows) {
        if (!row.selected || row.state === "done" || row.state === "skipped") continue;
        if (stop.current) break;
        update(row.problem.slug, { state: "running" });
        try {
          const outcome = await importProblem(
            prepared(row.problem),
            mode,
            transport,
            (value: ImportUpdate) => update(row.problem.slug, { ...value, ownedAttempt: true }),
            () => stop.current,
            row.ownedAttempt ? row.versionId : undefined,
          );
          update(row.problem.slug, { state: outcome });
        } catch (e) {
          update(row.problem.slug, {
            state: "error",
            message: e instanceof Error ? e.message : "Request failed; retry or open the saved problem",
          });
        }
      }
      await Promise.all([existingProblems.reload(), collectionsData.reload()]);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const pending = rows.filter((r) => r.selected && !["done", "skipped"].includes(r.state));
  const doneCount = rows.filter((r) => r.state === "done").length;
  const skippedCount = rows.filter((r) => r.state === "skipped").length;
  const errorCount = rows.filter((r) => r.state === "error").length;
  const totalTests = rows.reduce((n, r) => n + r.problem.tests.length, 0);
  const sampleTests = rows.reduce((n, r) => n + r.problem.tests.filter((t) => t.sample).length, 0);
  const newInFile = rows.filter((r) => !existingSlugs.has(r.problem.slug)).length;

  return (
    <div className="stack" style={{ gap: "1.1rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Problem Bank</div>
          <h1>Bulk import</h1>
          <p>
            Imported problems stay private in your Problem Bank until you assign them to Practice, a TD, a Mission, Duels, or a Contest.
          </p>
        </div>
        <div className="row">
          <button onClick={() => navigate("/admin/problems")}>
            <AdminIcon name="arrowLeft" /> Back to Problem Bank
          </button>
        </div>
      </div>

      <section className="card">
        <div className="import-setup-grid">
          <div className="file-drop-box">
            <Field
              label="1. Select bank file (.json or .json.gz)"
              hint="Format: infom4th.problem-bank v1 (1 to 100 problems, statements, samples, hidden tests, and reference solutions)."
            >
              <input
                type="file"
                accept=".json,.json.gz,.gz,application/json,application/gzip,application/x-gzip"
                disabled={busy || reading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void read(file);
                  e.target.value = "";
                }}
              />
            </Field>
            {reading && <span className="small muted">Reading and verifying file structure…</span>}
            {!reading && rows.length > 0 && (
              <div className="row" style={{ gap: "0.5rem", fontSize: "0.83rem" }}>
                <Badge tone="info">{fileName || "Loaded"}</Badge>
                <span className="muted">
                  <strong>{rows.length}</strong> problems ({newInFile} new · {rows.length - newInFile} existing) ·{" "}
                  <strong>{totalTests}</strong> tests ({sampleTests} samples)
                </span>
              </div>
            )}
          </div>

          <div className="stack" style={{ gap: "0.75rem" }}>
            <div className="grid grid-2" style={{ gap: "0.75rem" }}>
              <Field label="2. Validation step">
                <select disabled={busy || reading} value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
                  {organizer && <option value="approve">Validate & mark Ready (recommended)</option>}
                  <option value="validate">Validate only (keep in Review)</option>
                  <option value="draft">Save as Draft (skip judge)</option>
                  {organizer && <option value="duel">Validate, approve & add to Duel Pool</option>}
                </select>
              </Field>
              {organizer && (
                <Field label="Collection (optional)" hint="Private bank group to organize this batch.">
                  <input
                    list="bank-import-collections"
                    disabled={busy || reading}
                    maxLength={120}
                    value={collection}
                    onChange={(e) => setCollection(e.target.value)}
                    placeholder="e.g. C Course, Finals Pool…"
                  />
                  <datalist id="bank-import-collections">
                    {collections.map((c) => (
                      <option key={c.name} value={c.name} />
                    ))}
                  </datalist>
                </Field>
              )}
            </div>

            <div className="stack" style={{ gap: "0.4rem" }}>
              <label className="check small">
                <input
                  type="checkbox"
                  disabled={busy || reading}
                  checked={useAllServerLangs}
                  onChange={(e) => setUseAllServerLangs(e.target.checked)}
                />
                Enable all active judge languages ({enabledLangs.length ? `${enabledLangs.length} online` : "checking…"})
              </label>
              <label className="check small">
                <input
                  type="checkbox"
                  disabled={busy || reading}
                  checked={autoTag}
                  onChange={(e) => setAutoTag(e.target.checked)}
                />
                Auto-detect topic tags on untagged problems
              </label>
            </div>
          </div>
        </div>

        <ErrorBox error={error} />

        {!busy && doneCount > 0 && pending.length === 0 && (
          <div className="notice ok row-between" style={{ marginTop: "1rem" }}>
            <span>
              <strong>{doneCount}</strong> problem{doneCount === 1 ? "" : "s"} imported into your Private Problem Bank
              {activeCollection ? ` under "${activeCollection}"` : ""}.
              {skippedCount > 0 ? ` (${skippedCount} existing skipped)` : ""}
            </span>
            <button
              className="primary small"
              onClick={() =>
                navigate(
                  activeCollection
                    ? "/admin/problems?collection=" + encodeURIComponent(activeCollection)
                    : "/admin/problems",
                )
              }
            >
              Open in Problem Bank <AdminIcon name="arrowRight" />
            </button>
          </div>
        )}
      </section>

      {rows.length > 0 && (
        <section className="table-card">
          <div className="bulk-bar">
            <div className="bulk-left">
              <label className="check small" style={{ fontWeight: 600 }}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={rows.every((r) => r.selected)}
                  onChange={(e) => setRows((old) => old.map((r) => ({ ...r, selected: e.target.checked })))}
                />
                Select all ({rows.filter((r) => r.selected).length} / {rows.length})
              </label>
              <span className="small muted">
                {doneCount} completed · {skippedCount} skipped · {errorCount} errors
              </span>
            </div>
            <div className="bulk-right">
              {busy && (
                <button onClick={() => { stop.current = true; }}>
                  Stop after current
                </button>
              )}
              <button
                className="primary"
                disabled={busy || reading || pending.length === 0}
                onClick={() => void runImport()}
              >
                <AdminIcon name="upload" />
                {busy
                  ? "Importing…"
                  : errorCount > 0
                  ? `Retry / import ${pending.length} selected`
                  : `Import ${pending.length} to Private Bank`}
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: 42 }}>Sel</th>
                  <th>Problem</th>
                  <th style={{ width: 100 }}>Level</th>
                  <th style={{ width: 105 }}>Tests</th>
                  <th style={{ width: 190 }}>Topics</th>
                  <th style={{ width: 230 }}>Status</th>
                  <th style={{ width: 82 }} className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const topics = tagsFor(r.problem);
                  const targetCol = activeCollection ?? r.problem.folder;
                  const exists = existingSlugs.has(r.problem.slug) && r.state === "ready";
                  return (
                    <tr key={r.problem.slug} className={r.selected ? "row-selected" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={"Select " + r.problem.title}
                          disabled={busy || r.state === "done" || r.state === "skipped"}
                          checked={r.selected}
                          onChange={(e) => update(r.problem.slug, { selected: e.target.checked })}
                        />
                      </td>
                      <td>
                        <div className="cell-primary">
                          <span className="cell-title" title={r.problem.title}>{r.problem.title}</span>
                          {exists && <Badge tone="neutral">Exists</Badge>}
                          {targetCol && <span className="collection-pill" title={targetCol}>{targetCol}</span>}
                        </div>
                        <div className="cell-secondary">
                          <span className="cell-slug">{r.problem.slug}</span>
                          <span>· {LANGUAGE_NAMES[r.problem.reference.language] ?? r.problem.reference.language}</span>
                        </div>
                      </td>
                      <td>
                        <DifficultyPill value={r.problem.difficulty || "MEDIUM"} />
                      </td>
                      <td className="mono small">
                        {r.problem.tests.length}{" "}
                        <span className="muted">({r.problem.tests.filter((t) => t.sample).length}s)</span>
                      </td>
                      <td>
                        <div className="surface-pills" title={topics.map(topicLabel).join(", ")}>
                          {topics.length === 0 ? (
                            <span className="small muted">—</span>
                          ) : (
                            <>
                              {topics.slice(0, 2).map((t) => (
                                <span key={t} className="topic-mini">{topicLabel(t)}</span>
                              ))}
                              {topics.length > 2 && <span className="topic-mini">+{topics.length - 2}</span>}
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="cell-primary">
                          <Badge
                            tone={
                              r.state === "error"
                                ? "bad"
                                : r.state === "done"
                                ? "ok"
                                : r.state === "running"
                                ? "info"
                                : "neutral"
                            }
                          >
                            {r.state}
                          </Badge>
                          <span className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }} title={r.message}>
                            {r.message}
                          </span>
                        </div>
                      </td>
                      <td className="right">
                        <div className="row-actions">
                          {r.versionId && (
                            <a href={"#/admin/problems/" + r.versionId} target="_blank" rel="noreferrer" className="btn">
                              Open
                            </a>
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
    </div>
  );
}
