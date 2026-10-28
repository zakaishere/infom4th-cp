import { useEffect, useState } from "react";
import { get, patch, post, put } from "../../api";
import { navigate, useToast } from "../../app";
import { ProgressLog, StepNav, Steps, pairTestFiles, parsePastedTests, slugify, type LogLine } from "../../components/Wizard";
import { LanguagePicker } from "../../components/LanguagePicker";
import { CodeEditor, Field, LANGUAGE_NAMES, Markdown, TEMPLATES } from "../../ui";

type Test = { input: string; expected: string; sample: boolean };
type Draft = {
  title: string; slug: string; difficulty: string; timeLimitMs: number; memoryLimitMb: number; checker: string; languages: string[];
  statement: string; inputFormat: string; outputFormat: string; constraints: string; explanation: string;
  tests: Test[]; referenceLanguage: string; referenceCode: string; versionId?: string;
};
const KEY = "cp.problem-wizard";
const EMPTY: Draft = {
  title: "", slug: "", difficulty: "MEDIUM", timeLimitMs: 2000, memoryLimitMb: 256, checker: "TRIMMED_LINES", languages: ["CPP", "C", "JAVA", "PYTHON"],
  statement: "", inputFormat: "", outputFormat: "", constraints: "", explanation: "",
  tests: [{ input: "", expected: "", sample: true }], referenceLanguage: "CPP", referenceCode: TEMPLATES.CPP,
};
const STEPS = ["Basics", "Statement", "Tests", "Solution", "Validate & publish"];

export default function ProblemWizard() {
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => {
    try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return EMPTY; }
  });
  const [step, setStep] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [approveReason, setApproveReason] = useState("Reference solution validated in the sandbox");
  const [practice, setPractice] = useState(false);
  const [paste, setPaste] = useState("");
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ } }, [d]);
  const set = (change: Partial<Draft>) => setD((old) => ({ ...old, ...change }));
  const setTest = (i: number, change: Partial<Test>) => set({ tests: d.tests.map((t, j) => (i === j ? { ...t, ...change } : t)) });

  const problems: string[] = [];
  if (!d.title.trim()) problems.push("Title is required");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)) problems.push("Slug must be lowercase letters, digits and dashes");
  if (!d.statement.trim()) problems.push("Statement is empty");
  if (d.languages.length === 0) problems.push("Choose at least one language");
  if (!d.tests.some((t) => t.sample)) problems.push("Mark at least one test as a sample");
  if (!d.tests.some((t) => !t.sample)) problems.push("Add at least one hidden (non-sample) test");
  if (d.tests.some((t) => !t.expected.trim() && !t.input.trim())) problems.push("Remove empty tests");
  if (!d.referenceCode.trim()) problems.push("Add a correct reference solution");

  async function runStep(text: string, action: () => Promise<unknown>) {
    setLog((l) => [...l, { text, state: "running" }]);
    try {
      const result = await action();
      setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, state: "done" } : x)));
      return result;
    } catch (e) {
      setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, state: "error", text: x.text + " — " + (e instanceof Error ? e.message : "failed") } : x)));
      throw e;
    }
  }

  async function createAndValidate() {
    setBusy(true); setLog([]); setValidation(null);
    try {
      let id = d.versionId;
      // A draft remembered by this browser may no longer exist on the server (or may be sealed).
      if (id) {
        const known = await get<{ sealed_at: string | null }>("/api/lab/problems/" + id).catch(() => null);
        if (!known) id = undefined;
        else if (known.sealed_at) { setLog([{ text: "This version is already sealed; open the problem page and clone it to change it", state: "error" }]); setValidation("FAILED"); return; }
      }
      if (!id) {
        const created = await runStep("Creating draft", () => post("/api/lab/problems", { slug: d.slug, title: d.title, statement: d.statement, languages: d.languages }));
        id = (created as { versionId: string }).versionId;
        set({ versionId: id });
      }
      await runStep("Saving statement and limits", () => patch("/api/lab/problems/" + id, {
        title: d.title, statement: d.statement, inputFormat: d.inputFormat, outputFormat: d.outputFormat, constraints: d.constraints,
        explanation: d.explanation, difficulty: d.difficulty, checker: d.checker, timeLimitMs: d.timeLimitMs, memoryLimitMb: d.memoryLimitMb, languages: d.languages,
      }));
      await runStep(`Uploading ${d.tests.length} tests`, () => put("/api/lab/problems/" + id + "/tests", d.tests));
      const existing = await get<{ references: unknown[] }>("/api/lab/problems/" + id);
      if (existing.references.length === 0)
        await runStep("Adding reference solution", () => post("/api/lab/problems/" + id + "/references", { label: "Main solution", language: d.referenceLanguage, sourceCode: d.referenceCode, expectedVerdict: "ACCEPTED" }));
      await runStep("Sealing and running the reference solution on every test", () => post("/api/lab/problems/" + id + "/validate"));
      setValidation("PENDING");
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const v = await get<{ validations: { status: string }[] }>("/api/lab/problems/" + id);
        const status = v.validations[0]?.status;
        setValidation(status);
        if (status && !["PENDING", "RUNNING"].includes(status)) break;
      }
    } catch { /* shown in the log */ } finally { setBusy(false); }
  }

  async function approve() {
    setBusy(true);
    try {
      await runStep("Approving", () => post("/api/lab/problems/" + d.versionId + "/approve", { reason: approveReason }));
      if (practice) await runStep("Publishing to practice", () => post("/api/lab/problems/" + d.versionId + "/publish-practice"));
      toast("success", "Problem approved — it can now be added to contests.");
      const id = d.versionId;
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      navigate("/admin/problems/" + id);
    } catch { /* shown in the log */ } finally { setBusy(false); }
  }

  const reset = () => { if (confirm("Discard this draft and start over?")) { setD(EMPTY); setStep(0); setLog([]); setValidation(null); } };

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><a href="#/admin/problems" className="small">← Problems</a><h1>New problem</h1><p>Five short steps. Your work is saved in this browser as you type.</p></div>
        <button className="ghost small" onClick={reset}>Start over</button>
      </div>
      <Steps steps={STEPS} current={step} onSelect={setStep} />
      {d.versionId && step < 4 && <div className="notice small">This problem was already created on the server. Changes are applied when you validate again; sealed versions must be cloned from the problem page.</div>}

      <section className="card">
        {step === 0 && (
          <div className="grid grid-2">
            <Field label="Title"><input autoFocus value={d.title} onChange={(e) => set({ title: e.target.value, slug: d.versionId ? d.slug : slugify(e.target.value) })} placeholder="Sum of Two Numbers" /></Field>
            <Field label="Short name (URL)" hint="Generated from the title; must be unique."><input value={d.slug} disabled={Boolean(d.versionId)} onChange={(e) => set({ slug: e.target.value })} /></Field>
            <Field label="Time limit (seconds)"><input type="number" min={0.1} max={60} step={0.1} value={d.timeLimitMs / 1000} onChange={(e) => set({ timeLimitMs: Math.round(Number(e.target.value) * 1000) })} /></Field>
            <Field label="Memory limit (MB)"><input type="number" min={16} max={4096} value={d.memoryLimitMb} onChange={(e) => set({ memoryLimitMb: Number(e.target.value) })} /></Field>
            <Field label="Difficulty"><select value={d.difficulty} onChange={(e) => set({ difficulty: e.target.value })}><option>EASY</option><option>MEDIUM</option><option>HARD</option></select></Field>
            <Field label="Output comparison" hint="Trimmed lines ignores trailing spaces; tokens ignores all whitespace.">
              <select value={d.checker} onChange={(e) => set({ checker: e.target.value })}><option value="TRIMMED_LINES">Trimmed lines (recommended)</option><option value="TOKENS">Tokens</option><option value="EXACT">Exact</option></select></Field>
            <Field label="Allowed languages"><LanguagePicker value={d.languages} onChange={(languages) => set({ languages })} /></Field>
          </div>
        )}
        {step === 1 && (
          <div className="grid grid-2" style={{ alignItems: "start" }}>
            <div className="stack">
              <Field label="Statement" hint="Markdown: **bold**, `code`, blank line for a new paragraph."><textarea rows={9} value={d.statement} onChange={(e) => set({ statement: e.target.value })} /></Field>
              <Field label="Input format"><textarea rows={3} value={d.inputFormat} onChange={(e) => set({ inputFormat: e.target.value })} /></Field>
              <Field label="Output format"><textarea rows={3} value={d.outputFormat} onChange={(e) => set({ outputFormat: e.target.value })} /></Field>
              <Field label="Constraints"><textarea rows={2} value={d.constraints} onChange={(e) => set({ constraints: e.target.value })} placeholder="1 ≤ n ≤ 10^5" /></Field>
              <Field label="Notes (optional)"><textarea rows={2} value={d.explanation} onChange={(e) => set({ explanation: e.target.value })} /></Field>
            </div>
            <div className="card-flat"><div className="eyebrow">Contestant preview</div><h1>{d.title || "Untitled"}</h1><Markdown text={d.statement} />
              {d.inputFormat && <><h2>Input</h2><Markdown text={d.inputFormat} /></>}{d.outputFormat && <><h2>Output</h2><Markdown text={d.outputFormat} /></>}
              {d.constraints && <><h2>Constraints</h2><Markdown text={d.constraints} /></>}</div>
          </div>
        )}
        {step === 2 && (
          <div className="stack">
            <div className="grid grid-2">
              <div className="card-flat stack">
                <strong>Upload test files</strong>
                <span className="small muted">Select pairs like 01.in + 01.out (or .ans). They are matched by name and sorted.</span>
                <input type="file" multiple accept=".in,.out,.ans,.txt,.a,.input,.output" onChange={async (e) => {
                  if (!e.target.files) return;
                  const pairs = await pairTestFiles(e.target.files);
                  if (!pairs.length) { toast("error", "No matching input/output pairs found"); return; }
                  set({ tests: [...d.tests.filter((t) => t.input || t.expected), ...pairs.map((p, i) => ({ input: p.input, expected: p.expected, sample: d.tests.every((t) => !t.input && !t.expected) && i === 0 }))] });
                  toast("success", `Added ${pairs.length} tests`);
                  e.target.value = "";
                }} />
              </div>
              <div className="card-flat stack">
                <strong>Paste many tests</strong>
                <span className="small muted">Input, a line <code>---</code>, expected output. Separate tests with a line <code>===</code>.</span>
                <textarea rows={4} className="mono" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"2 3\n---\n5\n===\n10 20\n---\n30"} />
                <div><button className="small" disabled={!paste.trim()} onClick={() => {
                  const parsed = parsePastedTests(paste);
                  if (!parsed.length) { toast("error", "Nothing recognised; check the --- and === separators"); return; }
                  set({ tests: [...d.tests.filter((t) => t.input || t.expected), ...parsed.map((p) => ({ ...p, sample: false }))] });
                  setPaste(""); toast("success", `Added ${parsed.length} tests`);
                }}>Add pasted tests</button></div>
              </div>
            </div>
            <div className="row-between"><strong>{d.tests.length} tests · {d.tests.filter((t) => t.sample).length} shown as examples</strong>
              <button className="small" onClick={() => set({ tests: [...d.tests, { input: "", expected: "", sample: false }] })}>+ Add test</button></div>
            {d.tests.map((t, i) => (
              <div key={i} className="card-flat stack">
                <div className="row-between"><strong>Test {i + 1}</strong>
                  <div className="row"><label className="check small"><input type="checkbox" checked={t.sample} onChange={(e) => setTest(i, { sample: e.target.checked })} />Show as example</label>
                    <button className="small danger" onClick={() => set({ tests: d.tests.filter((_, j) => j !== i) })}>Remove</button></div></div>
                <div className="grid grid-2">
                  <textarea className="mono" rows={3} placeholder="Input" value={t.input} onChange={(e) => setTest(i, { input: e.target.value })} />
                  <textarea className="mono" rows={3} placeholder="Expected output" value={t.expected} onChange={(e) => setTest(i, { expected: e.target.value })} />
                </div>
              </div>
            ))}
          </div>
        )}
        {step === 3 && (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>Paste a correct solution. It runs on every test in the real sandbox to prove the tests and limits are right.</p>
            <Field label="Language"><select value={d.referenceLanguage} style={{ maxWidth: 220 }} onChange={(e) => set({ referenceLanguage: e.target.value, referenceCode: d.referenceCode.trim() && d.referenceCode !== TEMPLATES[d.referenceLanguage] ? d.referenceCode : TEMPLATES[e.target.value] ?? "" })}>
              {d.languages.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}</select></Field>
            <div style={{ height: 360, display: "flex" }}><CodeEditor value={d.referenceCode} onChange={(v) => set({ referenceCode: v })} language={d.referenceLanguage} /></div>
          </div>
        )}
        {step === 4 && (
          <div className="stack">
            {problems.length > 0 ? (
              <div className="notice warn"><strong>Fix these first</strong><ul className="small">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
            ) : validation === null && <div className="notice ok">Everything is filled in. Create the problem and test the reference solution.</div>}
            {validation === null || validation === "FAILED" || validation === "JUDGE_ERROR" ? (
              <div><button className="primary" disabled={busy || problems.length > 0} onClick={createAndValidate}>{d.versionId ? "Validate again" : "Create & validate"}</button></div>
            ) : null}
            <ProgressLog lines={log} />
            {(validation === "PENDING" || validation === "RUNNING") && <div className="notice">Judging the reference solution… this usually takes a few seconds once a judge slot is free.</div>}
            {(validation === "FAILED" || validation === "JUDGE_ERROR") && <div className="notice bad">Validation {validation === "FAILED" ? "failed: the reference solution did not pass every test. Fix the tests or the solution, then open the problem page and clone the version to edit it." : "hit a judge error. Check the judges, then validate again from the problem page."}
              <div><a href={"#/admin/problems/" + d.versionId}>Open problem page</a></div></div>}
            {validation === "PASSED" && (
              <div className="card-flat stack">
                <div className="notice ok">The reference solution passed every test.</div>
                <Field label="Approval note (audit log)"><input value={approveReason} onChange={(e) => setApproveReason(e.target.value)} /></Field>
                <label className="check"><input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} />Also publish to the Practice section</label>
                <div><button className="primary" disabled={busy || !approveReason.trim()} onClick={approve}>Approve problem</button></div>
              </div>
            )}
          </div>
        )}
        <StepNav current={step} last={STEPS.length - 1} onBack={() => setStep(step - 1)} onNext={() => setStep(step + 1)}
          nextDisabled={step === 0 && (!d.title.trim() || !d.slug)} />
      </section>
    </div>
  );
}
