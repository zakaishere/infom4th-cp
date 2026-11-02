import { useEffect, useState } from "react";
import { post } from "../api";
import { useData, useToast } from "../app";
import { submissionAccepted } from "../lib/latency";
import { DocsPanel } from "./DocsPanel";
import { describe, labelInput, parseSignature, starter, type Signature } from "../lib/functionMode";
import { CodeEditor, ErrorBox, LANGUAGE_NAMES, Loading, Markdown, Modal, TEMPLATES, VERDICTS, Verdict, timeOf, when } from "../ui";

export type ProblemDetail = {
  id: string; title: string; statement_md: string; input_format_md: string; output_format_md: string;
  constraints_md: string; explanation_md: string; time_limit_ms: number; memory_limit_mb: number; output_limit_kb: number;
  samples: { input_data: string; expected_output: string; explanation_md: string }[];
  languages: string[];
  /** JSON signature of a function problem; null when the program reads standard input. */
  function_signature?: string | null;
};

/** Starter code: the function to complete on function problems, the usual template otherwise. */
export function templateFor(language: string, signature: Signature | null) {
  return signature ? starter(language, signature) : TEMPLATES[language] ?? "";
}

export type SubmissionRow = {
  id: string; problem_slot: number | null; problem_version_id: string; language_code: string; submitted_at: string;
  status: string | null; verdict: string | null; execution_time_ms: number | null; peak_memory_kb: number | null;
  passed_tests: number | null; total_tests: number | null; submitted_by_handle?: string; samples_only?: boolean;
};

export const pending = (s: { status: string | null }) => s.status === "QUEUED" || s.status === "RUNNING" || s.status === "RETRY";

export function ProblemStatement({ problem, label }: { problem: ProblemDetail; label?: string }) {
  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => undefined);
  const signature = parseSignature(problem.function_signature);
  return (
    <article>
      <h1 style={{ marginBottom: "0.25rem" }}>{label && <span className="muted">{label}. </span>}{problem.title}</h1>
      <div className="row small muted" style={{ marginBottom: "1rem" }}>
        <span>Time limit: <strong>{problem.time_limit_ms / 1000}s</strong></span>
        <span>Memory: <strong>{problem.memory_limit_mb} MB</strong></span>
        <span>Output: <strong>{problem.output_limit_kb} KB</strong></span>
      </div>
      <Markdown text={problem.statement_md} />
      {signature && <>
        <h2>Function</h2>
        <pre>{describe(signature)}</pre>
        <p className="small muted">Complete the function in the editor; do not read input or print the answer. Anything you print is ignored, so printing to debug is fine.</p>
      </>}
      {problem.input_format_md && <><h2>Input</h2><Markdown text={problem.input_format_md} /></>}
      {problem.output_format_md && <><h2>Output</h2><Markdown text={problem.output_format_md} /></>}
      {problem.constraints_md && <><h2>Constraints</h2><Markdown text={problem.constraints_md} /></>}
      {problem.samples.length > 0 && <h2>Examples</h2>}
      {problem.samples.map((s, i) => (
        <div key={i}>
          <div className="sample">
            <div><div className="row-between small"><strong>Input {i + 1}</strong><button className="ghost small" onClick={() => copy(s.input_data)}>Copy</button></div>
              <pre>{signature ? labelInput(signature, s.input_data).map(([name, value]) => `${name} = ${value}`).join("\n") : s.input_data}</pre></div>
            <div><div className="row-between small"><strong>{signature ? "Returns" : "Output " + (i + 1)}</strong><button className="ghost small" onClick={() => copy(s.expected_output)}>Copy</button></div><pre>{s.expected_output}</pre></div>
          </div>
          {s.explanation_md && <Markdown text={s.explanation_md} />}
        </div>
      ))}
      {problem.explanation_md && <><h2>Notes</h2><Markdown text={problem.explanation_md} /></>}
    </article>
  );
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Plain-HTTP LAN deployments lack randomUUID; getRandomValues is still available.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function draftKey(scope: string, language: string) { return "cp.draft." + scope + "." + language; }
export function readDraft(scope: string, language: string) {
  try { return localStorage.getItem(draftKey(scope, language)); } catch { return null; }
}

/** Editor with language choice, autosaved drafts and idempotent submission. */
export function SubmitPanel({ scope, languages, path, disabled, disabledReason, onSubmitted, signature = null }: {
  scope: string; languages: string[]; path: string; disabled?: boolean; disabledReason?: string; onSubmitted: () => void; signature?: Signature | null;
}) {
  const toast = useToast();
  const [language, setLanguage] = useState(() => {
    try { const saved = localStorage.getItem("cp.language"); if (saved && languages.includes(saved)) return saved; } catch { /* ignore */ }
    return languages[0] ?? "CPP";
  });
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState(false);
  // One key per attempt; it is reused if the network fails so the server never duplicates a submission.
  const [attemptKey, setAttemptKey] = useState(uuid);
  useEffect(() => {
    if (!languages.includes(language) && languages[0]) setLanguage(languages[0]);
  }, [languages, language]);
  const template = templateFor(language, signature);
  useEffect(() => { setSource(readDraft(scope, language) ?? template); }, [scope, language]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem(draftKey(scope, language), source); } catch { /* ignore */ } }, 400);
    return () => clearTimeout(timer);
  }, [scope, language, source]);

  async function submit() {
    if (disabled || busy || !source.trim()) return;
    setBusy(true);
    const clicked = performance.now();
    try {
      const accepted = await post<{ submissionId: string }>(path, { language, sourceCode: source }, attemptKey);
      submissionAccepted(accepted.submissionId, clicked);
      setAttemptKey(uuid());
      toast("success", "Submitted. Judging starts as soon as a judge slot is free.");
      onSubmitted();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="editor-wrap">
      <div className="row-between">
        <div className="row">
          <select value={language} onChange={(e) => { setLanguage(e.target.value); try { localStorage.setItem("cp.language", e.target.value); } catch { /* ignore */ } }} style={{ width: "auto" }}>
            {languages.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l] ?? l}</option>)}
          </select>
          <button className="ghost small" onClick={() => { if (confirm("Replace your code with the template?")) setSource(template); }}>Reset</button>
          <button className="small" onClick={() => setDocs((open) => !open)} aria-expanded={docs}>Reference</button>
        </div>
        <button className="primary" disabled={disabled || busy || !source.trim() || languages.length === 0} onClick={submit} title="Ctrl+Enter">
          {busy ? "Submitting…" : "Submit ▸"}
        </button>
      </div>
      {disabled && disabledReason && <div className="notice warn small">{disabledReason}</div>}
      {languages.length === 0 && <div className="notice warn small">No language is currently enabled for this problem.</div>}
      <CodeEditor value={source} onChange={setSource} onSubmit={submit} language={language} />
      <div className="small muted">{signature ? "Complete the function; the judge calls it on every test." : "Read from standard input, write to standard output. Java classes must be named Main."} Drafts are saved in this browser. Press Tab to accept a suggestion.</div>
      {docs && <DocsPanel language={language} onClose={() => setDocs(false)} />}
    </div>
  );
}

export function SubmissionTable({ rows, labels, onOpen, showAuthor }: { rows: SubmissionRow[]; labels?: Record<number, string>; onOpen: (id: string) => void; showAuthor?: boolean }) {
  if (rows.length === 0) return <div className="empty">No submissions yet.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>#</th><th>When</th>{showAuthor && <th>By</th>}{labels && <th>Problem</th>}<th>Lang</th><th>Verdict</th><th className="right">Tests</th><th className="right">Time</th><th className="right">Memory</th></tr></thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.id} onClick={() => onOpen(s.id)} style={{ cursor: "pointer" }} title="Open details">
              <td className="small muted">{rows.length - i}</td>
              <td className="small">{timeOf(s.submitted_at)}</td>
              {showAuthor && <td className="small">@{s.submitted_by_handle}</td>}
              {labels && <td><strong>{s.problem_slot != null ? labels[s.problem_slot] ?? s.problem_slot : "—"}</strong></td>}
              <td className="small">{LANGUAGE_NAMES[s.language_code] ?? s.language_code}</td>
              <td><Verdict status={s.status} verdict={s.verdict} /></td>
              <td className="right small mono">{s.total_tests ? `${s.passed_tests}/${s.total_tests}` : ""}</td>
              <td className="right small mono">{s.execution_time_ms != null ? s.execution_time_ms + " ms" : ""}</td>
              <td className="right small mono">{s.peak_memory_kb ? Math.round(s.peak_memory_kb / 1024) + " MB" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type SubmissionDetail = {
  submission: { id: string; language_code: string; source_code: string; submitted_at: string };
  judging: { status: string; verdict: string | null; execution_time_ms: number | null; peak_memory_kb: number | null; passed_tests: number | null; total_tests: number | null; public_feedback: string | null; generation: number }[];
  cases?: { number: number; sample: boolean; verdict: string | null; execution_time_ms: number | null; peak_memory_kb: number | null }[];
};

/** Per-test results: which test failed, and how long each took. Hidden test data is never shown. */
export function TestCases({ cases, compileError }: { cases: NonNullable<SubmissionDetail["cases"]>; compileError: boolean }) {
  if (compileError) return null;
  const firstFailure = cases.find((c) => c.verdict && c.verdict !== "ACCEPTED");
  return (
    <div className="stack" style={{ gap: "0.4rem" }}>
      <strong>Tests</strong>
      {firstFailure && <div className="notice bad small">Failed on test {firstFailure.number}{firstFailure.sample ? " (an example from the statement — try it locally)" : ""}: {VERDICTS[firstFailure.verdict!]?.label ?? firstFailure.verdict}</div>}
      <div className="test-grid">
        {cases.map((c) => {
          const v = c.verdict ? VERDICTS[c.verdict] : null;
          return (
            <div key={c.number} className={"test-cell " + (v ? v.tone : "skipped")} title={c.verdict ? `${v?.label} · ${c.execution_time_ms ?? 0} ms · ${c.peak_memory_kb ? Math.round(c.peak_memory_kb / 1024) + " MB" : "memory n/a"}` : "Not run: judging stops at the first failed test"}>
              <span className="test-number">{c.number}{c.sample ? "*" : ""}</span>
              <span className="test-verdict">{v ? v.short : "—"}</span>
              <span className="test-time">{c.verdict ? (c.execution_time_ms ?? 0) + "ms" : ""}</span>
            </div>
          );
        })}
      </div>
      <span className="small muted">* example test from the statement · “—” not run (judging stops at the first failed test, except in IOI contests)</span>
    </div>
  );
}

export function SubmissionModal({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useData<SubmissionDetail>("/api/submissions/" + id, 3000);
  const latest = detail.data?.judging[0];
  return (
    <Modal title="Submission" onClose={onClose}>
      {!detail.data ? (detail.error ? <ErrorBox error={detail.error} /> : <Loading />) : (
        <div className="stack">
          <div className="row">
            <Verdict status={latest?.status} verdict={latest?.verdict} />
            <span className="small muted">{LANGUAGE_NAMES[detail.data.submission.language_code]} · {when(detail.data.submission.submitted_at)}</span>
          </div>
          {latest?.total_tests != null && (
            <div className="small">Passed {latest.passed_tests}/{latest.total_tests} tests · max {latest.execution_time_ms} ms · {latest.peak_memory_kb ? Math.round(latest.peak_memory_kb / 1024) + " MB" : "memory unavailable"}</div>
          )}
          {latest?.status === "FAILED" && <div className="notice warn small">The judge could not finish this submission. It does not count as a rejected attempt.</div>}
          {detail.data.cases && <TestCases cases={detail.data.cases} compileError={latest?.verdict === "COMPILATION_ERROR"} />}
          {latest?.public_feedback && <><strong>Compiler output</strong><pre className="card-flat small" style={{ maxHeight: 220, overflow: "auto" }}>{latest.public_feedback}</pre></>}
          <strong>Source</strong>
          <div style={{ height: 320, display: "flex" }}><CodeEditor value={detail.data.submission.source_code} language={detail.data.submission.language_code} readOnly /></div>
        </div>
      )}
    </Modal>
  );
}
