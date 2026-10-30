import { useEffect, useState } from "react";
import { post, put, patch } from "../../api";
import { navigate, useAction, useData } from "../../app";
import { Badge, CodeEditor, Empty, ErrorBox, Field, LANGUAGE_NAMES, Loading, Markdown, ReasonDialog, VERDICTS, when } from "../../ui";

const STATUS_TONE: Record<string, string> = { DRAFT: "neutral", IN_TESTING: "info", READY_FOR_REVIEW: "warn", APPROVED: "ok", PUBLISHED: "ok", ARCHIVED: "neutral" };

type LabRow = { id: string; slug: string; version_id: string; title: string; version_number: number; status: string; deleted_at: string | null };

export function ProblemList() {
  const [showDeleted, setShowDeleted] = useState(false);
  const list = useData<LabRow[]>("/api/lab/problems" + (showDeleted ? "?deleted=true" : ""));
  const [filter, setFilter] = useState("");
  const [target, setTarget] = useState<{ row: LabRow; action: "delete" | "restore" } | null>(null);
  const { run } = useAction();
  const rows = (list.data ?? []).filter((p) => (p.title + " " + p.slug).toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Problem lab</div><h1>{showDeleted ? "Deleted problems" : "Problems"}</h1>
          <p>{showDeleted ? "Restore a problem to use it again. Contest history and submissions were never removed."
            : "The wizard walks you through statement, tests, a reference solution, validation and approval. Open a problem for advanced editing."}</p></div>
        <div className="row">
          <button className="ghost" onClick={() => setShowDeleted(!showDeleted)}>{showDeleted ? "← Back to problems" : "🗑 Show deleted"}</button>
          {!showDeleted && <><button onClick={() => navigate("/admin/problems/import")}>Bulk import</button><button className="primary" onClick={() => navigate("/admin/problems/new")}>+ New problem</button></>}
        </div>
      </div>
      <input placeholder="Filter by title" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 320 }} />
      <ErrorBox error={list.error} />
      {list.loading ? <Loading /> : !rows.length ? <Empty>{showDeleted ? "No deleted problems." : "No problems yet."}</Empty> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Problem</th><th>Version</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.version_id}>
                <td><strong>{p.title}</strong><div className="small muted mono">{p.slug}</div></td>
                <td>v{p.version_number}</td>
                <td>{showDeleted ? <Badge>Deleted {p.deleted_at ? when(p.deleted_at) : ""}</Badge> : <Badge tone={STATUS_TONE[p.status]}>{p.status.replace(/_/g, " ")}</Badge>}</td>
                <td className="right"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                  {showDeleted ? <button className="small primary" onClick={() => setTarget({ row: p, action: "restore" })}>Restore</button> : <>
                    <a className="btn small" href={"#/admin/problems/" + p.version_id}>Open</a>
                    <button className="small danger" onClick={() => setTarget({ row: p, action: "delete" })} title="Delete this problem">Delete</button>
                  </>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {target && (
        <ReasonDialog title={(target.action === "delete" ? "Delete “" : "Restore “") + target.row.title + "”"} confirm={target.action === "delete" ? "Delete problem" : "Restore"}
          danger={target.action === "delete"} onClose={() => setTarget(null)}
          description={target.action === "delete"
            ? "The problem (all its versions) leaves the Problem lab, the contest wizard and Practice. Finished contests, scoreboards and submissions keep it, so nothing breaks. You can restore it later from “Show deleted”. A problem used by a contest that has not finished cannot be deleted."
            : "The problem comes back to the Problem lab. If it was in Practice, show it again from the Practice set."}
          onSubmit={(reason) => run(async () => { await post("/api/lab/problems/" + target.row.version_id + "/" + target.action, { reason }); setTarget(null); list.reload(); },
            target.action === "delete" ? "Problem deleted" : "Problem restored")} />
      )}
    </div>
  );
}

type Version = {
  id: string; problem_id: string; title: string; status: string; version_number: number; sealed_at: string | null; difficulty: string; checker: string;
  statement_md: string; input_format_md: string; output_format_md: string; constraints_md: string; explanation_md: string; setter_notes: string;
  time_limit_ms: number; memory_limit_mb: number; output_limit_kb: number;
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
          {p.status === "APPROVED" && <button disabled={busy} onClick={() => run(async () => { await post("/api/lab/problems/" + p.id + "/publish-practice"); await v.reload(); }, "Published to practice")}>Publish to practice</button>}
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
  });
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
        {text("inputFormat", "Input format")}
        {text("outputFormat", "Output format")}
        {text("constraints", "Constraints", 3)}
        {text("explanation", "Notes / explanation", 3)}
        {text("setterNotes", "Private setter notes (never shown to contestants)", 3)}
        <div className="grid grid-3">
          <Field label="Time limit (ms)"><input type="number" min={1} max={60000} disabled={sealed} value={f.timeLimitMs} onChange={(e) => setF({ ...f, timeLimitMs: Number(e.target.value) })} /></Field>
          <Field label="Memory (MB)" hint="Must fit the worker slot memory."><input type="number" min={16} max={4096} disabled={sealed} value={f.memoryLimitMb} onChange={(e) => setF({ ...f, memoryLimitMb: Number(e.target.value) })} /></Field>
          <Field label="Output (KB)"><input type="number" min={1} max={65536} disabled={sealed} value={f.outputLimitKb} onChange={(e) => setF({ ...f, outputLimitKb: Number(e.target.value) })} /></Field>
          <Field label="Checker"><select disabled={sealed} value={f.checker} onChange={(e) => setF({ ...f, checker: e.target.value })}>
            <option value="TRIMMED_LINES">Trimmed lines</option><option value="TOKENS">Tokens</option><option value="EXACT">Exact</option></select></Field>
          <Field label="Difficulty"><select disabled={sealed} value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>
            <option>EASY</option><option>MEDIUM</option><option>HARD</option></select></Field>
        </div>
        <Field label="Languages">
          <div className="chips">{["CPP", "C", "JAVA", "PYTHON"].map((l) => (
            <label key={l} className="check small"><input type="checkbox" disabled={sealed} checked={f.languages.includes(l)}
              onChange={(e) => setF({ ...f, languages: e.target.checked ? [...f.languages, l] : f.languages.filter((x) => x !== l) })} />{LANGUAGE_NAMES[l]}</label>
          ))}</div>
        </Field>
        {!sealed && <div><button className="primary" disabled={busy}>Save draft</button></div>}
      </form>
      <div className="card">
        <div className="row-between"><h3>Contestant preview</h3><button className="small" onClick={() => setPreview(!preview)}>{preview ? "Hide" : "Show"}</button></div>
        {preview && <><h1>{f.title}</h1><Markdown text={f.statement} /><h2>Input</h2><Markdown text={f.inputFormat} /><h2>Output</h2><Markdown text={f.outputFormat} /></>}
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
      <div className="notice small">Tests replace the whole suite (1-200 tests, 16 MiB total). Mark at least one sample (shown in the statement) and keep at least one hidden test.</div>
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
  const [form, setForm] = useState({ label: "Main solution", language: "CPP", expectedVerdict: "ACCEPTED", sourceCode: "" });
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
            <Field label="Language"><select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>{p.languages.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}</select></Field>
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
