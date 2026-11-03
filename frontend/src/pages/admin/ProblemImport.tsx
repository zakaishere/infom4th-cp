import { useEffect, useRef, useState } from "react";
import { get, post } from "../../api";
import { useAuth } from "../../app";
import { Badge, ErrorBox, Field } from "../../ui";
import { importProblem, readProblemBankFile, type BankProblem, type ImportMode, type ImportTransport, type ImportUpdate } from "../../lib/problemImport";

type Row = { problem: BankProblem; selected: boolean; state: "ready" | "running" | "done" | "skipped" | "error"; message: string; versionId?: string; ownedAttempt?: boolean };
const transport: ImportTransport = {
  importProblem: problem => post("/api/lab/problems/import", problem),
  status: id => get("/api/lab/problems/" + id + "/status"),
  action: (id, action, body) => post("/api/lab/problems/" + id + "/" + action, body ?? {}),
  wait: () => new Promise(resolve => setTimeout(resolve, 2000)),
};

/** Bulk import for the Problem lab, or (duel) straight into the duel problem pool. */
export default function ProblemImport({ duel = false }: { duel?: boolean }) {
  const { organizer } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<ImportMode>(duel && organizer ? "duel" : "validate");
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const stop = useRef(false), active = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; }; }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  const update = (slug: string, change: Partial<Row>) => {
    if (mounted.current) setRows(old => old.map(r => r.problem.slug === slug ? { ...r, ...change } : r));
  };
  async function read(file: File) {
    if (active.current) return;
    setReading(true); setError(null); setRows([]);
    try {
      const problems = await readProblemBankFile(file);
      if (mounted.current) setRows(problems.map(problem => ({ problem, selected: true, state: "ready", message: "Ready" })));
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e : new Error("Could not read this bank")); }
    finally { if (mounted.current) setReading(false); }
  }
  async function run() {
    if (active.current || reading) return;
    active.current = true; stop.current = false; setBusy(true); setError(null);
    try {
      for (const row of rows.filter(r => r.selected && r.state !== "done" && r.state !== "skipped")) {
        if (stop.current) break;
        update(row.problem.slug, { state: "running" });
        try {
          const outcome = await importProblem(row.problem, mode, transport, (value: ImportUpdate) => {
            update(row.problem.slug, { ...value, ownedAttempt: true });
          }, () => stop.current, row.ownedAttempt ? row.versionId : undefined);
          update(row.problem.slug, { state: outcome });
        } catch (e) {
          update(row.problem.slug, { state: "error", message: e instanceof Error ? e.message : "Request failed; retry or open the saved problem" });
        }
      }
    } finally { active.current = false; if (mounted.current) setBusy(false); }
  }
  const pending = rows.filter(r => r.selected && !["done", "skipped"].includes(r.state));
  const samples = rows.reduce((n, r) => n + r.problem.tests.filter(t => t.sample).length, 0);
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <a href={duel ? "#/admin/duel-problems" : "#/admin/problems"} className="small">{duel ? "Back to duel problems" : "Back to problems"}</a>
      <div className="page-head"><div><h1>{duel ? "Bulk import duel problems" : "Bulk import problems"}</h1>
        <p>{duel ? "Load a bank of short problems for duels. They go to the duel pool only, never to the public Practice page." : "Load a complete bank: statements, limits, samples, hidden tests and reference solutions."}</p></div></div>
      <section className="card stack">
        <Field label="Problem bank file (.json or .json.gz)" hint="Choose problem-bank.import.json.gz for the smaller download; the original JSON also works.">
          <input type="file" accept=".json,.json.gz,.gz,application/json,application/gzip,application/x-gzip" disabled={busy || reading} onChange={e => { const file = e.target.files?.[0]; if (file) void read(file); e.target.value = ""; }} />
        </Field>
        {reading && <p role="status">Reading and checking the bank…</p>}
        <Field label="After importing">
          <select disabled={busy || reading} value={mode} onChange={e => setMode(e.target.value as ImportMode)}>
            <option value="draft">Save drafts only</option>
            <option value="validate">Validate reference solutions</option>
            {organizer && !duel && <option value="approve">Validate and approve for contests</option>}
            {organizer && !duel && <option value="publish">Validate, approve and publish to Practice</option>}
            {organizer && duel && <option value="duel">Validate, approve and add to Duels</option>}
          </select>
        </Field>
        <p className="small muted">Existing slugs are skipped. Validation runs one problem at a time on your internal judge; all allowed languages need a verified online worker. Failed problems remain in the lab for review.</p>
        <p className="small muted">Keep this page open while importing. Stop pauses further steps; an in-flight save or judge job may finish. Retry continues saved versions from this page. Reopening a bank skips previously imported slugs.</p>
        <ErrorBox error={error} />
        {rows.length > 0 && <>
          <div className="row-between"><strong>{rows.length} problems · {rows.reduce((n, r) => n + r.problem.tests.length, 0)} tests · {samples} public samples</strong>
            <label className="check small"><input type="checkbox" disabled={busy} checked={rows.every(r => r.selected)} onChange={e => setRows(old => old.map(r => ({ ...r, selected: e.target.checked })))} />Select all</label></div>
          <div className="row">
            <button className="primary" disabled={busy || reading || pending.length === 0} onClick={() => void run()}>{busy ? "Importing…" : rows.some(r => r.state === "error") ? `Retry / import ${pending.length} problems` : `Import ${pending.length} problems`}</button>
            {busy && <button onClick={() => { stop.current = true; }}>Stop</button>}
            <span className="small muted" role="status" aria-live="polite">{rows.filter(r => r.state === "done").length} completed · {rows.filter(r => r.state === "skipped").length} skipped · {rows.filter(r => r.state === "error").length} need attention</span>
          </div>
        </>}
      </section>
      {rows.length > 0 && <div className="card table-wrap"><table>
        <thead><tr><th>Select</th><th>Problem</th><th>Tests</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map(r => <tr key={r.problem.slug}>
          <td><input type="checkbox" aria-label={"Import " + r.problem.title} disabled={busy || r.state === "done" || r.state === "skipped"} checked={r.selected} onChange={e => update(r.problem.slug, { selected: e.target.checked })} /></td>
          <td><strong>{r.problem.title}</strong><div className="small muted mono">{r.problem.slug} · {r.problem.reference.language}</div></td>
          <td>{r.problem.tests.length}</td>
          <td><Badge tone={r.state === "error" ? "bad" : r.state === "done" ? "ok" : r.state === "running" ? "info" : "neutral"}>{r.state}</Badge><div className="small" style={{ maxWidth: 420 }}>{r.message}</div></td>
          <td>{r.versionId && <a href={"#/admin/problems/" + r.versionId} target="_blank" rel="noreferrer" className="btn small">Open</a>}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>
  );
}
