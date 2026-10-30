import { useEffect, useState } from "react";
import { download, post } from "../../api";
import { useAction, useData } from "../../app";
import { Badge, Empty, ErrorBox, Field, Loading, Modal, ReasonDialog, Stat, VERDICTS, when } from "../../ui";

type Metric = { label: string; count: number; min: number; avg: number; p50: number; p95: number; p99: number; max: number };
type State = {
  problem: { state: "NONE" | "VALIDATING" | "FAILED" | "READY" | "STALE"; version_id?: string; title?: string; statement_md?: string; tests?: number; time_limit_ms?: number; memory_limit_mb?: number; languages: { code: string; display_name: string }[] };
  samples: Record<string, string>;
  limits: { maxSubmissions: number; maxSpreadSeconds: number; maxSource: number };
  workers: { lane: string; workers: number; slots: number | null }[];
  contestBusy: boolean;
  runs: { id: string; language_code: string; lane: string; submission_count: number; spread_seconds: number; created_at: string; cancelled_at: string | null; created_by: string; active: boolean }[];
};
type Row = {
  position: number; submission_id: string; status: string; verdict: string | null; passed_tests: number | null; total_tests: number | null; worker: string | null; attempts: number; error: string | null;
  total_ms: number | null; wait_ms: number | null; dispatch_ms: number | null; compile_ms: number | null; tests_ms: number | null; sandbox_ms: number | null; execution_time_ms: number | null; peak_memory_kb: number | null;
};
type Report = {
  id: string; language_code: string; lane: string; submission_count: number; tests: number; active: boolean; cancelled_at: string | null; custom_source: boolean; created_at: string;
  summary: { submissions: number; finished: number; failed: number; waiting: number; accepted: number; elapsed_ms?: number; per_minute?: number; metrics: Record<string, Metric>; verdicts: Record<string, number>; workers: Record<string, number> };
  rows: Row[];
};

const ms = (n?: number | null) => (n == null ? "–" : n.toLocaleString());
const LANE_NAME: Record<string, string> = { official: "Contest judges", internal: "Practice judges" };

function RunReport({ id, onChanged }: { id: string; onChanged: () => void }) {
  const live = useData<Report>("/api/admin/benchmark/runs/" + id);
  const [cancel, setCancel] = useState(false);
  const { busy, run } = useAction();
  const r = live.data;
  const active = r?.active;
  // A report can hold a thousand rows, so it only refreshes while something can still change.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") live.reload(); }, 2000);
    return () => { clearInterval(timer); onChanged(); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  if (live.loading) return <Loading label="Loading the report…" />;
  if (!r) return <ErrorBox error={live.error} />;
  const s = r.summary, done = s.finished + s.failed, m = s.metrics;
  return (
    <section className="card stack">
      <div className="row-between">
        <div>
          <h3 style={{ marginBottom: "0.2rem" }}>{r.submission_count} × {r.language_code} on {LANE_NAME[r.lane] ?? r.lane}</h3>
          <div className="small muted">{when(r.created_at)} · {r.tests} tests each{r.custom_source ? " · custom program" : ""}</div>
        </div>
        <div className="row">
          {r.active ? <Badge tone="info">Running</Badge> : r.cancelled_at ? <Badge tone="warn">Cancelled</Badge> : <Badge tone="ok">Finished</Badge>}
          {r.active && <button className="danger small" onClick={() => setCancel(true)}>Cancel</button>}
          <button className="primary small" disabled={busy} onClick={() => run(() => download(`/api/admin/benchmark/runs/${r.id}/report.xlsx`, `benchmark-${r.id.slice(0, 8)}.xlsx`))}>Download Excel</button>
        </div>
      </div>
      <div className="bar"><div style={{ width: (100 * done) / Math.max(1, s.submissions) + "%" }} /></div>
      <div className="small muted">{done} of {s.submissions} done · {s.accepted} accepted{s.failed ? ` · ${s.failed} failed or cancelled` : ""}{s.waiting ? ` · ${s.waiting} still waiting` : ""}</div>

      <div className="grid benchmark-stats">
        <Stat label="Total latency, avg" value={ms(m.total_ms?.avg) + " ms"} hint={`p95 ${ms(m.total_ms?.p95)} ms`} />
        <Stat label="Queue wait, avg" value={ms(m.wait_ms?.avg) + " ms"} hint={`p95 ${ms(m.wait_ms?.p95)} ms`} />
        <Stat label="Compile, avg" value={ms(m.compile_ms?.avg) + " ms"} />
        <Stat label="Running tests, avg" value={ms(m.tests_ms?.avg) + " ms"} />
        <Stat label="Sandbox overhead, avg" value={ms(m.sandbox_ms?.avg) + " ms"} />
        <Stat label="Throughput" value={s.per_minute != null ? s.per_minute + " / min" : "–"} hint={s.elapsed_ms != null ? `${(s.elapsed_ms / 1000).toFixed(1)} s elapsed` : undefined} />
      </div>

      {Object.keys(m).length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Timing</th><th className="right">Min</th><th className="right">Avg</th><th className="right">P50</th><th className="right">P95</th><th className="right">P99</th><th className="right">Max</th></tr></thead>
            <tbody>{Object.entries(m).map(([key, x]) => (
              <tr key={key}><td>{x.label}</td>{[x.min, x.avg, x.p50, x.p95, x.p99, x.max].map((v, i) => <td key={i} className="right mono">{ms(v)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <details>
        <summary className="benchmark-summary">Every submission ({r.rows.length})</summary>
        <div className="table-wrap benchmark-rows">
          <table>
            <thead><tr><th className="right">#</th><th>Verdict</th><th className="right">Tests</th><th className="right">Total</th><th className="right">Wait</th><th className="right">Compile</th><th className="right">Tests</th><th className="right">Overhead</th><th className="right">Slowest test</th><th className="right">Memory</th><th>Worker</th></tr></thead>
            <tbody>{r.rows.map((x) => (
              <tr key={x.position}>
                <td className="right mono">{x.position}</td>
                <td>{x.verdict ? <Badge tone={VERDICTS[x.verdict]?.tone}>{VERDICTS[x.verdict]?.short ?? x.verdict}</Badge> : <span className="small muted">{x.error === "BENCHMARK_CANCELLED" ? "Cancelled" : x.status}</span>}</td>
                <td className="right mono">{x.total_tests != null ? `${x.passed_tests}/${x.total_tests}` : "–"}</td>
                <td className="right mono">{ms(x.total_ms)}</td><td className="right mono">{ms(x.wait_ms)}</td><td className="right mono">{ms(x.compile_ms)}</td><td className="right mono">{ms(x.tests_ms)}</td><td className="right mono">{ms(x.sandbox_ms)}</td><td className="right mono">{ms(x.execution_time_ms)}</td>
                <td className="right mono">{x.peak_memory_kb != null ? (x.peak_memory_kb / 1024).toFixed(1) + " MB" : "–"}</td>
                <td className="small">{x.worker ?? "–"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
      <p className="small muted" style={{ margin: 0 }}>All times are in milliseconds and start when a submission entered the queue. The Excel file has every timing and each test of each submission.</p>
      {cancel && <ReasonDialog title="Cancel this benchmark" danger confirm="Cancel benchmark" description="Submissions still waiting are dropped. Ones already being judged finish normally."
        onClose={() => setCancel(false)} onSubmit={(reason) => run(async () => { await post(`/api/admin/benchmark/runs/${r.id}/cancel`, { reason }); setCancel(false); live.reload(); onChanged(); }, "Benchmark cancelled")} />}
    </section>
  );
}

export default function Benchmark() {
  const state = useData<State>("/api/admin/benchmark", 5000);
  const { busy, run } = useAction();
  const [form, setForm] = useState({ count: 20, language: "", lane: "official", spreadSeconds: 0 });
  const [source, setSource] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [statement, setStatement] = useState(false);
  if (state.loading) return <Loading />;
  if (!state.data) return <ErrorBox error={state.error} />;
  const d = state.data, p = d.problem;
  const language = form.language && p.languages.some((l) => l.code === form.language) ? form.language : p.languages.some((l) => l.code === "CPP") ? "CPP" : p.languages[0]?.code ?? "";
  const lane = d.workers.find((w) => w.lane === form.lane);
  const running = d.runs.some((r) => r.active);
  const shown = selected ?? d.runs[0]?.id ?? null;
  const blocked = form.lane === "official" && d.contestBusy;
  const code = source ?? d.samples[language] ?? "";
  const prepareLabel = p.state === "NONE" ? "Create the benchmark problem" : "Rebuild the benchmark problem";
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">System</div><h1>Benchmark</h1>
          <p>Send many submissions through the real queue and judges, then see how long each one took. Results never count for Sigma, ratings or practice.</p></div>
      </div>

      <section className="card stack">
        <div className="row-between">
          <div>
            <h3 style={{ marginBottom: "0.2rem" }}>Benchmark problem</h3>
            <div className="small muted">Private: not in the Problem lab, Practice or any contest. Only super administrators see it here.</div>
          </div>
          {p.state === "READY" ? <Badge tone="ok">Ready</Badge> : p.state === "VALIDATING" ? <Badge tone="info">Validating…</Badge> : p.state === "NONE" ? <Badge>Not created</Badge> : <Badge tone="warn">{p.state === "STALE" ? "Judges changed" : "Validation failed"}</Badge>}
        </div>
        {p.title && <div className="small">{p.title} · {p.tests} tests · {p.time_limit_ms} ms · {p.memory_limit_mb} MB · {p.languages.length ? p.languages.map((l) => l.code).join(", ") : "no language ready"} <button className="ghost small" onClick={() => setStatement(true)}>Statement</button></div>}
        {p.state === "FAILED" && <div className="notice bad small">The reference solution did not pass. Check that the judges are healthy, then rebuild.</div>}
        {p.state === "STALE" && <div className="notice warn small">The judge images changed since this problem was validated, so rebuild it.</div>}
        {p.state !== "VALIDATING" && (
          <div><button className={p.state === "READY" ? "small" : "primary"} disabled={busy || running} onClick={() => run(async () => { await post("/api/admin/benchmark/problem"); await state.reload(); }, "Validating the benchmark problem")}>{prepareLabel}</button></div>
        )}
      </section>

      {p.state === "READY" && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); setConfirm(true); }}>
          <h3>New benchmark</h3>
          <div className="grid benchmark-form">
            <Field label="Submissions" hint={`1 to ${d.limits.maxSubmissions}`}><input type="number" required min={1} max={d.limits.maxSubmissions} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} /></Field>
            <Field label="Language"><select value={language} onChange={(e) => { setForm({ ...form, language: e.target.value }); setSource(null); }}>{p.languages.map((l) => <option key={l.code} value={l.code}>{l.display_name}</option>)}</select></Field>
            <Field label="Judges" hint={lane ? `${lane.workers} online, ${lane.slots ?? 0} slots` : "None online"}>
              <select value={form.lane} onChange={(e) => setForm({ ...form, lane: e.target.value })}><option value="official">Contest judges</option><option value="internal">Practice judges</option></select></Field>
            <Field label="Spread over (seconds)" hint="0 sends them all at once"><input type="number" required min={0} max={d.limits.maxSpreadSeconds} value={form.spreadSeconds} onChange={(e) => setForm({ ...form, spreadSeconds: Number(e.target.value) })} /></Field>
          </div>
          <details>
            <summary className="benchmark-summary">Program to submit{source != null ? " (edited)" : ""}</summary>
            <textarea className="mono benchmark-source" spellCheck={false} maxLength={d.limits.maxSource} value={code} onChange={(e) => setSource(e.target.value)} />
            {source != null && <button type="button" className="small" onClick={() => setSource(null)}>Use the standard solution</button>}
          </details>
          {blocked && <div className="notice warn small">A contest is running or starts within 30 minutes, so the contest judges are off limits. Use the practice judges or wait.</div>}
          {form.lane === "internal" && <div className="notice small">Practice judges are shared with people practising right now, and they will wait behind this benchmark.</div>}
          {running && <div className="notice small">A benchmark is running. One runs at a time.</div>}
          <div><button className="primary" disabled={busy || running || blocked || !lane || !code.trim()}>Start benchmark</button></div>
        </form>
      )}

      {shown && <RunReport key={shown} id={shown} onChanged={state.reload} />}

      <section className="card stack">
        <h3>Past benchmarks</h3>
        {d.runs.length === 0 ? <Empty>No benchmarks yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Started</th><th className="right">Submissions</th><th>Language</th><th>Judges</th><th>By</th><th>Status</th><th /></tr></thead>
              <tbody>{d.runs.map((r) => (
                <tr key={r.id}>
                  <td className="small">{when(r.created_at)}</td><td className="right mono">{r.submission_count}</td><td>{r.language_code}</td><td className="small">{LANE_NAME[r.lane] ?? r.lane}</td><td className="small">@{r.created_by}</td>
                  <td>{r.active ? <Badge tone="info">Running</Badge> : r.cancelled_at ? <Badge tone="warn">Cancelled</Badge> : <Badge tone="ok">Finished</Badge>}</td>
                  <td className="right"><button className="small" disabled={r.id === shown} onClick={() => setSelected(r.id)}>{r.id === shown ? "Shown" : "Open"}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {statement && <Modal title={p.title ?? "Benchmark problem"} onClose={() => setStatement(false)}><p>{p.statement_md}</p></Modal>}
      {confirm && <ReasonDialog title={`Send ${form.count} submissions`} confirm="Start benchmark"
        description={`${form.count} × ${language} on ${LANE_NAME[form.lane]}. This uses real judge capacity until it finishes.`}
        onClose={() => setConfirm(false)}
        onSubmit={(reason) => run(async () => {
          const r = await post<{ runId: string }>("/api/admin/benchmark/runs", { ...form, language, reason, sourceCode: source ?? undefined });
          setConfirm(false); setSelected(r.runId); await state.reload();
        }, "Benchmark started")} />}
    </div>
  );
}
