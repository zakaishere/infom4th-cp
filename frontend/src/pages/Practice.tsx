import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { get, post } from "../api";
import { navigate, useData, useToast } from "../app";
import { ProblemStatement, SubmissionModal, SubmissionTable, TestCases, draftKey, readDraft, templateFor, uuid,
  type ProblemDetail, type SubmissionDetail, type SubmissionRow } from "../components/Problem";
import { submissionAccepted, verdictShown } from "../lib/latency";
import { CodeEditor, Empty, ErrorBox, LANGUAGE_NAMES, Loading, Ring, VERDICTS } from "../ui";
import { parseSignature } from "../lib/functionMode";
import { DocsPanel } from "../components/DocsPanel";

export type PracticeProblem = {
  problem_id: string; id: string; title: string; slug: string; difficulty: "EASY" | "MEDIUM" | "HARD";
  tags: string[]; published_at: string; time_limit_ms: number; memory_limit_mb: number;
  solved_by: number; tried_by: number; submissions: number; accepted: number; my_status: "SOLVED" | "TRIED" | null;
};
type Catalog = { problems: PracticeProblem[]; tags: string[] };

const DIFFICULTY: Record<string, { label: string; rank: number }> = {
  EASY: { label: "Easy", rank: 1 }, MEDIUM: { label: "Medium", rank: 2 }, HARD: { label: "Hard", rank: 3 },
};
export const acceptance = (p: { submissions: number; accepted: number }) => (p.submissions ? Math.round((100 * p.accepted) / p.submissions) : null);

export function DifficultyPill({ value }: { value: string }) {
  return <span className={"difficulty " + value.toLowerCase()}>{DIFFICULTY[value]?.label ?? value}</span>;
}

function StatusIcon({ status }: { status: PracticeProblem["my_status"] }) {
  if (status === "SOLVED") return <span className="status-icon solved" title="Solved">✓</span>;
  if (status === "TRIED") return <span className="status-icon tried" title="Attempted, not solved yet">●</span>;
  return <span className="status-icon" title="Not attempted" />;
}

type Filters = { q: string; difficulty: string; status: string; tags: string[]; sort: string };
const DEFAULT_FILTERS: Filters = { q: "", difficulty: "", status: "", tags: [], sort: "newest" };
function loadFilters(): Filters {
  try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem("cp.practice.filters") ?? "{}") }; } catch { return DEFAULT_FILTERS; }
}

export function PracticeList() {
  const catalog = useData<Catalog>("/api/practice", 60000);
  const [f, setF] = useState<Filters>(loadFilters);
  const set = (patch: Partial<Filters>) => setF((old) => {
    const next = { ...old, ...patch };
    try { localStorage.setItem("cp.practice.filters", JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const all = catalog.data?.problems ?? [];
  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const rows = all.filter((p) =>
      (!q || (p.title + " " + p.slug + " " + p.tags.join(" ")).toLowerCase().includes(q)) &&
      (!f.difficulty || p.difficulty === f.difficulty) &&
      (!f.status || (f.status === "UNSOLVED" ? p.my_status !== "SOLVED" : f.status === "TODO" ? !p.my_status : p.my_status === f.status)) &&
      f.tags.every((t) => p.tags.includes(t)));
    const sorters: Record<string, (a: PracticeProblem, b: PracticeProblem) => number> = {
      newest: (a, b) => b.published_at.localeCompare(a.published_at),
      easiest: (a, b) => DIFFICULTY[a.difficulty].rank - DIFFICULTY[b.difficulty].rank || b.solved_by - a.solved_by,
      hardest: (a, b) => DIFFICULTY[b.difficulty].rank - DIFFICULTY[a.difficulty].rank || a.solved_by - b.solved_by,
      popular: (a, b) => b.solved_by - a.solved_by,
      acceptance: (a, b) => (acceptance(b) ?? -1) - (acceptance(a) ?? -1),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return [...rows].sort(sorters[f.sort] ?? sorters.newest);
  }, [all, f]);
  const solved = all.filter((p) => p.my_status === "SOLVED");
  const byDifficulty = (["EASY", "MEDIUM", "HARD"] as const).map((d) => ({ d, total: all.filter((p) => p.difficulty === d).length, solved: solved.filter((p) => p.difficulty === d).length }));
  const filtered = f.q || f.difficulty || f.status || f.tags.length > 0;
  const random = () => {
    const pool = shown.filter((p) => p.my_status !== "SOLVED");
    const pick = (pool.length ? pool : shown)[Math.floor(Math.random() * (pool.length || shown.length))];
    if (pick) navigate("/practice/" + pick.id);
  };

  return (
    <main className="page page-wide">
      <section className="practice-hero">
        <div className="stack" style={{ gap: "0.4rem" }}>
          <div className="eyebrow">Train between contests</div>
          <h1 style={{ margin: 0 }}>Practice problems</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 560 }}>Solve at your own pace. Run your code on the examples, then submit: every submission is
            compiled and judged on the hidden tests by the same sandbox as the contests.</p>
        </div>
        <div className="practice-progress">
          <Ring value={solved.length} max={all.length || 1} size={96}><strong>{solved.length}</strong><span className="muted">/ {all.length}</span></Ring>
          <div className="stack" style={{ gap: "0.45rem", minWidth: 200 }}>
            <strong>Your progress</strong>
            {byDifficulty.map(({ d, total, solved: n }) => (
              <div key={d} className="progress-line">
                <DifficultyPill value={d} />
                <div className={"bar diff-" + d.toLowerCase()}><div style={{ width: (total ? (100 * n) / total : 0) + "%" }} /></div>
                <span className="small mono">{n}/{total}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="practice-filters">
        <input className="search" placeholder="Search by title or tag…" value={f.q} onChange={(e) => set({ q: e.target.value })} />
        <div className="filters">
          {["", "EASY", "MEDIUM", "HARD"].map((d) => (
            <button key={d || "all"} className={f.difficulty === d ? "active" : ""} onClick={() => set({ difficulty: d })}>{d ? DIFFICULTY[d].label : "All levels"}</button>
          ))}
        </div>
        <select value={f.status} onChange={(e) => set({ status: e.target.value })} style={{ width: "auto" }}>
          <option value="">Any status</option><option value="TODO">Not started</option><option value="TRIED">Attempted</option>
          <option value="SOLVED">Solved</option><option value="UNSOLVED">Not solved yet</option>
        </select>
        <select value={f.sort} onChange={(e) => set({ sort: e.target.value })} style={{ width: "auto" }}>
          <option value="newest">Newest first</option><option value="easiest">Easiest first</option><option value="hardest">Hardest first</option>
          <option value="popular">Most solved</option><option value="acceptance">Highest acceptance</option><option value="title">Title A–Z</option>
        </select>
        <button onClick={random} disabled={!shown.length} title="Open a random unsolved problem from this list">🎲 Random</button>
        {filtered && <button className="ghost small" onClick={() => set({ ...DEFAULT_FILTERS, sort: f.sort })}>Clear filters</button>}
      </section>
      {(catalog.data?.tags.length ?? 0) > 0 && (
        <div className="tag-filter">
          <span className="small muted">Topics:</span>
          {catalog.data!.tags.map((t) => (
            <button key={t} className={"tag-chip" + (f.tags.includes(t) ? " active" : "")}
              onClick={() => set({ tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] })}>{t}</button>
          ))}
        </div>
      )}

      <ErrorBox error={catalog.error} />
      {catalog.loading ? <Loading /> : all.length === 0 ? <Empty>No practice problems yet. Organizers publish them from the Control room → Practice set.</Empty>
        : shown.length === 0 ? <Empty>No problem matches these filters. <button className="ghost small" onClick={() => set(DEFAULT_FILTERS)}>Clear filters</button></Empty> : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="practice-table">
            <thead><tr><th style={{ width: 44 }} /><th>Problem</th><th>Difficulty</th><th className="right">Acceptance</th><th className="right">Solved by</th><th className="right hide-narrow">Limits</th></tr></thead>
            <tbody>
              {shown.map((p) => {
                const rate = acceptance(p);
                return (
                  <tr key={p.id} className={p.my_status === "SOLVED" ? "row-solved" : ""} onClick={() => navigate("/practice/" + p.id)}>
                    <td><StatusIcon status={p.my_status} /></td>
                    <td>
                      <a href={"#/practice/" + p.id} className="problem-link" onClick={(e) => e.stopPropagation()}>{p.title}</a>
                      {p.tags.length > 0 && <div className="tags">{p.tags.map((t) => <span key={t} className="tag-chip small" onClick={(e) => { e.stopPropagation(); if (!f.tags.includes(t)) set({ tags: [...f.tags, t] }); }}>{t}</span>)}</div>}
                    </td>
                    <td><DifficultyPill value={p.difficulty} /></td>
                    <td className="right mono">{rate == null ? <span className="muted">—</span> : rate + "%"}</td>
                    <td className="right"><span className="mono">{p.solved_by}</span> <span className="small muted">users</span></td>
                    <td className="right small muted hide-narrow">{p.time_limit_ms / 1000}s · {p.memory_limit_mb}MB</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 0 && <p className="small muted" style={{ marginTop: "0.6rem" }}>Showing {shown.length} of {all.length} problems. Acceptance = accepted ÷ all judged submissions.</p>}
    </main>
  );
}

type Practice = ProblemDetail & { stats: PracticeProblem };
type Outcome = { kind: "run" | "submit"; id: string; detail?: SubmissionDetail };

/** Split-screen workspace: statement on the left, colourful editor and results on the right. */
export function PracticeProblem({ versionId }: { versionId: string }) {
  const problem = useData<Practice>("/api/practice/" + versionId);
  const catalog = useData<Catalog>("/api/practice");
  const history = useData<SubmissionRow[]>("/api/submissions");
  const toast = useToast();
  const [tab, setTab] = useState<"statement" | "submissions">("statement");
  const [open, setOpen] = useState<string | null>(null);
  const [language, setLanguage] = useState("CPP");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState<"run" | "submit" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [docs, setDocs] = useState(false);
  const [split, setSplit] = useState(() => { try { return Number(localStorage.getItem("cp.practice.split")) || 46; } catch { return 46; } });
  const keys = useRef<{ run: string; submit: string }>({ run: uuid(), submit: uuid() });
  const scope = "practice." + versionId;
  const languages = problem.data?.languages ?? [];

  useEffect(() => {
    if (!languages.length) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("cp.language"); } catch { /* ignore */ }
    setLanguage((current) => (languages.includes(current) ? current : saved && languages.includes(saved) ? saved : languages[0]));
  }, [languages.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  // Function problems start from their starter code, which is only known once the problem has loaded.
  const loaded = Boolean(problem.data);
  const template = templateFor(language, parseSignature(problem.data?.function_signature));
  useEffect(() => { if (loaded) setSource(readDraft(scope, language) ?? template); }, [scope, language, template, loaded]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => { try { localStorage.setItem(draftKey(scope, language), source); } catch { /* ignore */ } }, 400);
    return () => clearTimeout(timer);
  }, [scope, language, source, loaded]);

  // Follow the latest run/submission until it has a verdict.
  const outcomeId = outcome?.id;
  const outcomeDone = Boolean(outcome?.detail?.judging[0]?.verdict) || outcome?.detail?.judging[0]?.status === "FAILED";
  const reloadHistory = history.reload, reloadProblem = problem.reload;
  useEffect(() => {
    if (!outcomeId || outcomeDone) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const detail = await get<SubmissionDetail>("/api/submissions/" + outcomeId);
        if (cancelled) return;
        setOutcome((o) => (o && o.id === outcomeId ? { ...o, detail } : o));
        if (detail.judging[0]?.verdict) { verdictShown(outcomeId); reloadHistory(); reloadProblem(); }
      } catch { /* transient; retried */ }
    };
    tick();
    const timer = setInterval(tick, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [outcomeId, outcomeDone, reloadHistory, reloadProblem]);

  const send = useCallback(async (kind: "run" | "submit") => {
    if (busy || !source.trim()) return;
    setBusy(kind);
    const clicked = performance.now();
    try {
      const r = await post<{ submissionId: string }>("/api/practice/" + versionId + "/submissions",
        kind === "run" ? { language, sourceCode: source, mode: "samples" } : { language, sourceCode: source }, keys.current[kind]);
      submissionAccepted(r.submissionId, clicked);
      keys.current[kind] = uuid();
      setOutcome({ kind, id: r.submissionId });
      reloadHistory();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not send your code");
    } finally { setBusy(null); }
  }, [busy, source, language, versionId, toast, reloadHistory]);

  const mine = (history.data ?? []).filter((s) => s.problem_version_id === versionId && s.problem_slot == null);
  const list = catalog.data?.problems ?? [];
  const index = list.findIndex((p) => p.id === versionId);
  const neighbour = (step: number) => list[index + step];

  // Drag the divider between statement and editor.
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const pct = Math.min(70, Math.max(28, (100 * e.clientX) / window.innerWidth));
      setSplit(pct);
    };
    const up = () => { if (dragging.current) { dragging.current = false; document.body.classList.remove("resizing"); try { localStorage.setItem("cp.practice.split", String(split)); } catch { /* ignore */ } } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [split]);

  if (problem.loading) return <Loading label="Opening the problem…" />;
  if (!problem.data) return <main className="page"><ErrorBox error={problem.error} /><a href="#/practice">← Practice problems</a></main>;
  const p = problem.data, stats = p.stats, rate = acceptance(stats);
  const result = outcome?.detail?.judging[0];

  return (
    <div className="workspace" style={{ gridTemplateColumns: `${split}% 6px minmax(0, 1fr)` }}>
      <section className="ws-left">
        <div className="ws-bar">
          <a href="#/practice" className="small">← Problems</a>
          <span className="spacer" />
          <button className="ghost small" disabled={!neighbour(-1)} onClick={() => neighbour(-1) && navigate("/practice/" + neighbour(-1).id)} title="Previous problem">‹ Prev</button>
          <button className="ghost small" disabled={!neighbour(1)} onClick={() => neighbour(1) && navigate("/practice/" + neighbour(1).id)} title="Next problem">Next ›</button>
        </div>
        <div className="ws-tabs">
          <button className={tab === "statement" ? "active" : ""} onClick={() => setTab("statement")}>Description</button>
          <button className={tab === "submissions" ? "active" : ""} onClick={() => setTab("submissions")}>Submissions{mine.length ? ` (${mine.length})` : ""}</button>
        </div>
        <div className="ws-scroll">
          <div className="ws-meta">
            <DifficultyPill value={stats.difficulty} />
            {stats.my_status === "SOLVED" && <span className="badge ok">✓ Solved</span>}
            {stats.my_status === "TRIED" && <span className="badge warn">Attempted</span>}
            <span className="small muted">Solved by <strong>{stats.solved_by}</strong> · Acceptance <strong>{rate == null ? "—" : rate + "%"}</strong></span>
          </div>
          {stats.tags.length > 0 && <div className="tags" style={{ marginBottom: "0.75rem" }}>{stats.tags.map((t) => <span key={t} className="tag-chip small">{t}</span>)}</div>}
          {tab === "statement" ? <ProblemStatement problem={p} /> : (
            <div className="stack">
              <SubmissionTable rows={mine} onOpen={setOpen} />
              <span className="small muted">“Run” entries were judged on the examples only and do not count.</span>
            </div>
          )}
        </div>
      </section>
      <div className="ws-divider" onPointerDown={(e) => { e.preventDefault(); dragging.current = true; document.body.classList.add("resizing"); }} title="Drag to resize" />
      <section className="ws-right">
        <div className="ws-bar">
          <select value={language} onChange={(e) => { setLanguage(e.target.value); try { localStorage.setItem("cp.language", e.target.value); } catch { /* ignore */ } }} style={{ width: "auto" }}>
            {languages.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l] ?? l}</option>)}
          </select>
          <button className="ghost small" onClick={() => { if (confirm("Replace your code with the starter template?")) setSource(template); }} title="Reset to the starter template">↺ Reset</button>
          <button className="small" onClick={() => setDocs((value) => !value)} aria-expanded={docs}>Reference</button>
          <span className="spacer" />
          <span className="small muted hide-narrow">Draft saved</span>
          <button onClick={() => send("run")} disabled={Boolean(busy) || !source.trim() || !p.samples.length} title={p.samples.length ? "Judge on the examples only (Ctrl+')" : "This problem has no examples"}>
            {busy === "run" ? "Sending…" : "▶ Run examples"}
          </button>
          <button className="primary" onClick={() => send("submit")} disabled={Boolean(busy) || !source.trim() || !languages.length} title="Judge on all tests (Ctrl+Enter)">
            {busy === "submit" ? "Sending…" : "Submit"}
          </button>
        </div>
        {languages.length === 0 && <div className="notice warn small">No language is currently available for this problem.</div>}
        <div className="ws-editor"><CodeEditor value={source} onChange={setSource} language={language} onSubmit={() => send("submit")} onRun={() => send("run")} /></div>
        {docs && <DocsPanel language={language} onClose={() => setDocs(false)} />}
        <div className={"ws-console" + (result?.verdict ? " has-result" : "")}>
          {!outcome ? (
            <div className="small muted">Write your solution, then <strong>▶ Run examples</strong> to check it on the statement's examples, or <strong>Submit</strong> to be judged on every test. {p.function_signature ? "Complete the function; the judge calls it on every test." : <>Read from standard input, print to standard output{languages.includes("JAVA") ? "; Java classes must be named Main" : ""}.</>}</div>
          ) : !result?.verdict && result?.status !== "FAILED" ? (
            <div className="row"><span className="spinner" /><strong>{outcome.kind === "run" ? "Running on the examples…" : "Judging on all tests…"}</strong>
              <span className="small muted">{result?.status === "RUNNING" ? "compiling and running" : "waiting for a free judge"}</span></div>
          ) : (
            <div className="stack" style={{ gap: "0.6rem" }}>
              <div className="row">
                <span className={"verdict-big " + (VERDICTS[result!.verdict ?? ""]?.tone ?? "neutral")}>{result!.verdict ? VERDICTS[result!.verdict]?.label ?? result!.verdict : "Judge error"}</span>
                <span className="small muted">{outcome.kind === "run" ? "Examples only (not counted)" : "All tests"}{result!.total_tests ? ` · ${result!.passed_tests}/${result!.total_tests} passed` : ""}
                  {result!.execution_time_ms != null ? ` · ${result!.execution_time_ms} ms` : ""}{result!.peak_memory_kb ? ` · ${Math.round(result!.peak_memory_kb / 1024)} MB` : ""}</span>
                <span className="spacer" />
                <button className="ghost small" onClick={() => setOpen(outcome.id)}>Details</button>
              </div>
              {outcome.kind === "run" && result!.verdict === "ACCEPTED" && <div className="notice ok small">Examples pass. Submit to be judged on the hidden tests.</div>}
              {outcome.kind === "submit" && result!.verdict === "ACCEPTED" && <div className="notice ok small">🎉 Accepted! This problem is now marked as solved.</div>}
              {outcome.detail?.cases && <TestCases cases={outcome.detail.cases} compileError={result!.verdict === "COMPILATION_ERROR"} />}
              {result!.public_feedback && <pre className="compiler-output">{result!.public_feedback}</pre>}
            </div>
          )}
        </div>
      </section>
      {open && <SubmissionModal id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

