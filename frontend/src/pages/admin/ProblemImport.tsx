import { useEffect, useRef, useState } from "react";
import { get, post } from "../../api";
import { useAuth, useData } from "../../app";
import { Badge, ErrorBox, Field, FlagBadge } from "../../ui";
import { DifficultyPill } from "../Practice";
import { FUNCTION_LANGUAGES } from "../../lib/functionMode";
import { STANDARD_TOPICS, suggestTopics, topicLabel } from "../../lib/topics";
import { importProblem, readProblemBankFile, type BankProblem, type ImportMode, type ImportTransport, type ImportUpdate } from "../../lib/problemImport";

type Row = { problem: BankProblem; selected: boolean; state: "ready" | "running" | "done" | "skipped" | "error"; message: string; versionId?: string; ownedAttempt?: boolean };
const transport: ImportTransport = {
  importProblem: problem => post("/api/lab/problems/import", problem),
  status: id => get("/api/lab/problems/" + id + "/status"),
  action: (id, action, body) => post("/api/lab/problems/" + id + "/" + action, body ?? {}),
  wait: () => new Promise(resolve => setTimeout(resolve, 2000)),
};

type Dest = "file" | "practice" | "td" | "mission";
const slugify = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** Bulk import for the Problem lab, or (duel) straight into the duel problem pool. */
export default function ProblemImport({ duel = false }: { duel?: boolean }) {
  const { organizer } = useAuth();
  const serverLangs = useData<{ code: string; enabled: boolean }[]>("/api/languages");
  const enabledLangs = (serverLangs.data ?? []).filter((l) => l.enabled).map((l) => l.code);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<ImportMode>(duel && organizer ? "duel" : "validate");
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  // Where published problems go. "file" keeps what the bank names (a TD, a mission, or Problem Set).
  const [dest, setDest] = useState<Dest>("file"), [tdNumber, setTdNumber] = useState(1), [missionTitle, setMissionTitle] = useState("");
  const [flagPreset, setFlagPreset] = useState(""), [customFlag, setCustomFlag] = useState("");
  const [folder, setFolder] = useState("");
  const [autoTag, setAutoTag] = useState(true);
  const [useAllServerLangs, setUseAllServerLangs] = useState(true);
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const activeFlag = (flagPreset === "CUSTOM" ? customFlag.trim() : flagPreset) || undefined;
  const activeFolder = folder.trim() || undefined;
  const tagsFor = (problem: BankProblem) => {
    const base = problem.tags?.length ? problem.tags.map((t) => t.trim().toLowerCase()).filter(Boolean) : autoTag ? suggestTopics(problem) : [];
    return [...new Set([...base, ...extraTags])].slice(0, 8);
  };
  const langsFor = (problem: BankProblem) => {
    if (!useAllServerLangs || enabledLangs.length === 0) return problem.languages;
    const pool = problem.functionSignature ? enabledLangs.filter((l) => FUNCTION_LANGUAGES.includes(l)) : enabledLangs;
    const merged = [...new Set([...pool, problem.reference.language])].filter((l) => enabledLangs.includes(l));
    return merged.length > 0 ? merged : problem.languages;
  };
  const placed = (problem: BankProblem, index: number): BankProblem => {
    const { td, mission, ...rest } = problem;
    const tags = tagsFor(problem);
    const languages = langsFor(problem);
    const contestFlag = activeFlag ?? problem.contestFlag;
    const targetFolder = activeFolder ?? problem.folder;
    const withMeta = (p: BankProblem): BankProblem => ({ ...p, languages, tags, ...(contestFlag ? { contestFlag } : {}), ...(targetFolder ? { folder: targetFolder } : {}) });
    if (dest === "file") return withMeta(problem);
    if (dest === "practice") return withMeta(rest);
    if (dest === "td") return withMeta({ ...rest, td: { number: tdNumber, position: td?.position ?? index + 1 } });
    return withMeta({ ...rest, mission: { slug: slugify(missionTitle), title: missionTitle.trim(), description: mission?.description ?? "", position: mission?.position ?? index + 1, weight: mission?.weight ?? 10 } });
  };
  const where = (problem: BankProblem, index: number) => {
    const x = placed(problem, index);
    return x.mission ? { label: "Mission: " + x.mission.title, tone: "info" } : x.td ? { label: "TD " + x.td.number, tone: "info" } : { label: "Problem Set", tone: "warn" };
  };
  const destinationOk = mode !== "publish" || dest !== "mission" || slugify(missionTitle).length >= 2;
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
      for (const [index, row] of rows.entries()) {
        if (!row.selected || row.state === "done" || row.state === "skipped") continue;
        if (stop.current) break;
        update(row.problem.slug, { state: "running" });
        try {
          const outcome = await importProblem(placed(row.problem, index), mode, transport, (value: ImportUpdate) => {
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
        <p>{duel ? "Load a bank of short problems for duels. They go to the duel pool only, never to the public Problem Set." : "Load a complete bank: statements, limits, samples, hidden tests and reference solutions."}</p></div></div>
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
            {organizer && !duel && <option value="publish">Validate, approve and publish (choose where below)</option>}
            {organizer && duel && <option value="duel">Validate, approve and add to Duels</option>}
          </select>
        </Field>
        {mode === "publish" && !duel && <>
          <Field label="Publish to" hint="Mission and TD problems never appear in the public Problem Set. Only 'Problem Set' does.">
            <select disabled={busy || reading} value={dest} onChange={e => setDest(e.target.value as Dest)}>
              <option value="file">As named in the file (see the Goes to column)</option>
              <option value="practice">Problem Set (everyone signed in sees them)</option>
              <option value="td">A TD (academic section)</option>
              <option value="mission">A mission (scored TP)</option>
            </select>
          </Field>
          {dest === "td" && <Field label="TD number"><input type="number" min={1} max={99} disabled={busy || reading} value={tdNumber} onChange={e => setTdNumber(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} /></Field>}
          {dest === "mission" && <Field label="Mission title" hint="A new mission is created with this title; typing the title of an existing mission adds the problems to it. Points default to 10 per problem unless the file sets them.">
            <input value={missionTitle} disabled={busy || reading} placeholder="Python — TP3" onChange={e => setMissionTitle(e.target.value)} />
          </Field>}
        </>}
        {!duel && organizer && (
          <div className="grid grid-2">
            <Field label="Library folder (optional)" hint="Use / for subfolders, e.g. Warmup/Week 1, Warmup/Week 2, Basic, Contests.">
              <input list="import-folders" disabled={busy || reading} maxLength={120} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="e.g. Warmup/Week 1 or Basic" />
              <datalist id="import-folders">
                <option value="Warmup/Week 1" />
                <option value="Warmup/Week 2" />
                <option value="Basic" />
                <option value="Contests" />
                <option value="Problem Set" />
              </datalist>
            </Field>
            <Field label="Flag imported problems for" hint="Makes it 1 click to load these problems into a Basic, Warmup, or Normal contest.">
              <select disabled={busy || reading} value={flagPreset} onChange={(e) => setFlagPreset(e.target.value)}>
                <option value="">Keep file flag / none</option>
                <option value="BASIC">Basic (small event / easy)</option>
                <option value="WARMUP">Warmup (long round)</option>
                <option value="STANDARD">Contest (normal round)</option>
                <option value="CUSTOM">Custom flag…</option>
              </select>
            </Field>
            {flagPreset === "CUSTOM" && (
              <Field label="Custom flag name" hint="e.g. finals, round-1, spring-cup">
                <input disabled={busy || reading} maxLength={32} value={customFlag} onChange={(e) => setCustomFlag(e.target.value)} placeholder="e.g. round-1" />
              </Field>
            )}
          </div>
        )}
        {!duel && (
          <div className="stack" style={{ gap: "0.5rem" }}>
            <label className="check small">
              <input type="checkbox" disabled={busy || reading} checked={useAllServerLangs} onChange={(e) => setUseAllServerLangs(e.target.checked)} />
              Enable all active server languages ({enabledLangs.length ? `${enabledLangs.length} online` : "loading…"}) for every imported problem
            </label>
            <label className="check small">
              <input type="checkbox" disabled={busy || reading} checked={autoTag} onChange={(e) => setAutoTag(e.target.checked)} />
              Auto-detect topic categories (Hash Map, Math, DP, Graphs…) for untagged problems
            </label>
            <div className="tag-filter" style={{ margin: 0 }}>
              <span className="small muted">Add topic to all:</span>
              {STANDARD_TOPICS.slice(0, 12).map((t) => (
                <button key={t} type="button" disabled={busy || reading}
                  className={"tag-chip" + (extraTags.includes(t) ? " active" : "")}
                  onClick={() => setExtraTags((old) => old.includes(t) ? old.filter((x) => x !== t) : [...old, t].slice(0, 4))}>
                  {topicLabel(t)}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="small muted">Existing slugs are skipped (if a flag or topics are selected above, existing untagged slugs still receive them). Validation runs one problem at a time on your internal judge; all allowed languages need a verified online worker. Failed problems remain in the lab for review.</p>
        <p className="small muted">Keep this page open while importing. Stop pauses further steps; an in-flight save or judge job may finish. Retry continues saved versions from this page. Reopening a bank skips previously imported slugs.</p>
        <ErrorBox error={error} />
        {rows.length > 0 && <>
          <div className="row-between"><strong>{rows.length} problems · {rows.reduce((n, r) => n + r.problem.tests.length, 0)} tests · {samples} public samples</strong>
            <label className="check small"><input type="checkbox" disabled={busy} checked={rows.every(r => r.selected)} onChange={e => setRows(old => old.map(r => ({ ...r, selected: e.target.checked })))} />Select all</label></div>
          <div className="row">
            <button className="primary" disabled={busy || reading || pending.length === 0 || !destinationOk} onClick={() => void run()}>{busy ? "Importing…" : rows.some(r => r.state === "error") ? `Retry / import ${pending.length} problems` : `Import ${pending.length} problems`}</button>
            {busy && <button onClick={() => { stop.current = true; }}>Stop</button>}
            <span className="small muted" role="status" aria-live="polite">{rows.filter(r => r.state === "done").length} completed · {rows.filter(r => r.state === "skipped").length} skipped · {rows.filter(r => r.state === "error").length} need attention</span>
          </div>
        </>}
      </section>
      {rows.length > 0 && <div className="card table-wrap" style={{ padding: 0 }}><table className="library-table">
        <thead><tr>
          <th style={{ width: 38 }}>Sel</th>
          <th>Problem</th>
          <th style={{ width: 70 }}>Tests</th>
          {!duel && <th style={{ width: 130 }}>Goes to</th>}
          <th style={{ width: 240 }}>Status</th>
          <th style={{ width: 80 }} />
        </tr></thead>
        <tbody>{rows.map((r, index) => <tr key={r.problem.slug}>
          <td><input type="checkbox" aria-label={"Import " + r.problem.title} disabled={busy || r.state === "done" || r.state === "skipped"} checked={r.selected} onChange={e => update(r.problem.slug, { selected: e.target.checked })} /></td>
          <td>
            <div className="lib-title-row">
              <strong>{r.problem.title}</strong>
              <DifficultyPill value={r.problem.difficulty || "MEDIUM"} />
              {(activeFlag ?? r.problem.contestFlag) && <FlagBadge flag={activeFlag ?? r.problem.contestFlag} />}
              {(activeFolder ?? r.problem.folder) && <span className="tag" style={{ fontSize: "0.75rem" }}>📁 {activeFolder ?? r.problem.folder}</span>}
            </div>
            <div className="lib-sub-row">
              <span className="small muted mono">{r.problem.slug} · {r.problem.reference.language}</span>
              {!duel && tagsFor(r.problem).map((t) => <span key={t} className="tag-chip small">{topicLabel(t)}</span>)}
            </div>
          </td>
          <td className="mono small">{r.problem.tests.length}</td>
          {!duel && <td>{mode === "publish" ? (() => { const w = where(r.problem, index); return <Badge tone={w.tone}>{w.label}</Badge>; })() : <span className="small muted">Library only</span>}</td>}
          <td><Badge tone={r.state === "error" ? "bad" : r.state === "done" ? "ok" : r.state === "running" ? "info" : "neutral"}>{r.state}</Badge><div className="small muted">{r.message}</div></td>
          <td className="right">{r.versionId && <a href={"#/admin/problems/" + r.versionId} target="_blank" rel="noreferrer" className="btn small">Open</a>}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>
  );
}
