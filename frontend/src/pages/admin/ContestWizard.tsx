import { useEffect, useState } from "react";
import { displayTimeZone, get, post, serverNow } from "../../api";
import { navigate, useData } from "../../app";
import { ProgressLog, StepNav, Steps, slugify, type LogLine } from "../../components/Wizard";
import { LanguagePicker } from "../../components/LanguagePicker";
import { SCORING_INFO } from "../../components/Standings";
import { Badge, Empty, Field, Loading, fromZoneInput, toZoneInput, when } from "../../ui";

type Lab = { version_id: string; title: string; slug: string; status: string };
type Draft = {
  title: string; slug: string; mode: "INDIVIDUAL" | "TEAM"; maxTeamSize: number; hours: number; minutes: number;
  freezeMinutes: number; penaltyMinutes: number; penalizeCompilationErrors: boolean; languages: string[];
  description: string; rules: string; problems: string[]; participants: string; startsAt: string; visibility: string;
  scoring: "ICPC" | "IOI" | "CODEFORCES" | "ATCODER"; points: Record<string, number>;
  /** WARMUP: a multi-day contest whose problems open day by day (see the backend V26 migration). */
  kind: "STANDARD" | "WARMUP"; days: number; dayOf: Record<string, number>; publishToPractice: boolean;
};
const KEY = "cp.contest-wizard";
const WARMUP_RULES = "- A new set of problems opens every day at the start time.\n- Earlier days stay open until the end: you can catch up any time.\n- Each problem counts your best submission (points for the tests it passes).\n- No time penalty and no full screen: solve at your own pace.\n- Do not share code until the warmup ends; the problems then move to Practice.";
const RULES = "- Standard ICPC scoring: most problems solved, then least total time.\n- Each rejected attempt before acceptance adds the penalty below.\n- Ask questions about statements through Clarifications.\n- Do not share code during the contest.";
/** The next full hour in the platform's time zone, as a datetime-local value. */
function nextHour() {
  return toZoneInput(serverNow() + 60 * 60 * 1000).slice(0, 14) + "00";
}
/** ISO instant of the chosen start, read in the platform's time zone. */
const startIso = (value: string) => new Date(fromZoneInput(value)).toISOString();
const EMPTY: Draft = {
  title: "", slug: "", mode: "INDIVIDUAL", maxTeamSize: 3, hours: 3, minutes: 0, freezeMinutes: 60, penaltyMinutes: 20,
  penalizeCompilationErrors: false, languages: ["CPP", "C", "JAVA", "PYTHON"], description: "", rules: RULES,
  problems: [], participants: "", startsAt: nextHour(), visibility: "PUBLIC", scoring: "ICPC", points: {},
  kind: "STANDARD", days: 7, dayOf: {}, publishToPractice: true,
};
const defaultPoints = (scoring: Draft["scoring"], i: number) => (scoring === "IOI" ? 100 : scoring === "CODEFORCES" ? 500 * (i + 1) : scoring === "ATCODER" ? 100 * (i + 1) : 1);
const STEPS = ["Details", "Problems", "Participants", "Schedule"];
const label = (i: number) => String.fromCharCode(65 + i);

export default function ContestWizard() {
  const lab = useData<Lab[]>("/api/lab/problems");
  const [d, setD] = useState<Draft>(() => {
    try { return { ...EMPTY, startsAt: nextHour(), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { ...EMPTY, startsAt: nextHour() }; }
  });
  const [step, setStep] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ } }, [d]);
  const set = (change: Partial<Draft>) => setD((old) => ({ ...old, ...change }));
  const approved = (lab.data ?? []).filter((p) => p.status === "APPROVED" || p.status === "PUBLISHED");
  const titles = Object.fromEntries((lab.data ?? []).map((p) => [p.version_id, p.title]));
  const warmup = d.kind === "WARMUP";
  const duration = warmup ? d.days * 86400 : d.hours * 3600 + d.minutes * 60;
  const dayOf = (version: string) => Math.min(d.days, Math.max(1, d.dayOf[version] ?? 1));
  // A warmup's letters follow its days: day 1 problems first, then day 2, and so on.
  const ordered = warmup ? [...d.problems].sort((a, b) => dayOf(a) - dayOf(b)) : d.problems;
  const handles = d.participants.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const issues: string[] = [];
  if (!d.title.trim()) issues.push("Title is required");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)) issues.push("Short name must be lowercase letters, digits and dashes");
  if (warmup && !(d.days >= 1 && d.days <= 31)) issues.push("A warmup lasts 1 to 31 days");
  if (!warmup && duration < 60) issues.push("Duration must be at least one minute");
  if (!warmup && d.freezeMinutes * 60 >= duration) issues.push("Freeze must be shorter than the contest");
  if (d.problems.length === 0) issues.push("Choose at least one problem");
  if (d.languages.length === 0) issues.push("Choose at least one language");
  const emptyDays = warmup ? Array.from({ length: d.days }, (_, i) => i + 1).filter((day) => !d.problems.some((v) => dayOf(v) === day)) : [];

  async function run(text: string, action: () => Promise<unknown>) {
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

  async function finish(schedule: boolean, startNow = false) {
    setBusy(true); setLog([]);
    try {
      let id = created;
      if (!id) {
        const r = await run("Creating contest", () => post<{ competitionId: string }>("/api/manage/competitions", {
          slug: d.slug, title: d.title, mode: d.mode, maxTeamSize: d.mode === "TEAM" ? d.maxTeamSize : 1, languages: d.languages,
          ...(warmup
            ? { format: "WARMUP", days: d.days, publishToPractice: d.publishToPractice }
            : { durationSeconds: duration, scoringSystem: d.scoring, freezeBeforeEndSeconds: d.freezeMinutes * 60 }),
          // The API rejects blank optional text; leave it out instead.
          ...(d.description.trim() ? { description: d.description } : {}), ...(d.rules.trim() ? { rules: d.rules } : {}),
          wrongAttemptPenaltySeconds: d.penaltyMinutes * 60, penalizeCompilationErrors: d.penalizeCompilationErrors,
        }));
        id = (r as { competitionId: string }).competitionId;
        setCreated(id);
        for (const [i, version] of ordered.entries())
          await run(`Adding problem ${label(i)}${warmup ? ` (day ${dayOf(version)})` : ""}: ${titles[version] ?? version}`, () => post("/api/manage/competitions/" + id + "/problems", {
            versionId: version, slot: i + 1, label: label(i),
            ...(warmup ? { releaseDay: dayOf(version) } : d.scoring === "ICPC" ? {} : { points: d.points[version] ?? defaultPoints(d.scoring, i) }),
          }));
      }
      if (handles.length && d.mode === "INDIVIDUAL") {
        const result = await run(`Registering ${handles.length} participant(s)`, () => post<{ user: string; status: string }[]>("/api/manage/competitions/" + id + "/participants", { users: handles }));
        const missing = (result as { user: string; status: string }[]).filter((r) => r.status === "NOT_FOUND" || r.status === "INACTIVE");
        if (missing.length) setLog((l) => [...l, { text: "Not found or inactive: " + missing.map((m) => m.user).join(", "), state: "error" }]);
      }
      if (!schedule) { finishDraft(id!); return; }
      // The backend requires a rehearsal before scheduling; this automatic one is ended immediately.
      let teamIds: string[] | undefined;
      if (d.mode === "TEAM") {
        const team = await run("Creating a jury test team for the rehearsal", () => post<{ teamId: string }>("/api/teams", { name: "Jury check " + d.slug.slice(0, 80) }));
        teamIds = [(team as { teamId: string }).teamId];
      }
      const rehearsal = await run("Running the automatic rehearsal check", () => post<{ runId: string }>("/api/manage/competitions/" + id + "/rehearsals", teamIds ? { teamIds } : {}));
      await run("Ending the rehearsal", () => post("/api/manage/runs/" + (rehearsal as { runId: string }).runId + "/control", { action: "end-rehearsal", reason: "Automatic pre-schedule check" }));
      const ready = await run("Checking readiness (approved problems, online judges, runtimes)", () => get<{ ready: boolean; errors: string[] }>("/api/manage/competitions/" + id + "/readiness"));
      if (!(ready as { ready: boolean }).ready) {
        setLog((l) => [...l, ...(ready as { errors: string[] }).errors.map((e) => ({ text: e, state: "error" as const }))]);
        throw new Error("not ready");
      }
      if (startNow) await run("Starting the contest now", () => post("/api/manage/competitions/" + id + "/schedule", { startNow: true, visibility: d.visibility, reason: "Started from the contest wizard" }));
      else await run(`Scheduling for ${when(startIso(d.startsAt))}`, () => post("/api/manage/competitions/" + id + "/schedule", { startsAt: startIso(d.startsAt), visibility: d.visibility }));
      finishDraft(id!);
    } catch { /* details are in the log; the contest page can finish the remaining steps */ } finally { setBusy(false); }
  }
  function finishDraft(id: string) {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    navigate("/admin/contests/" + id);
  }
  const move = (i: number, delta: number) => {
    // Indexes are those of the list as shown (sorted by day in a warmup).
    const list = [...ordered]; const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]]; set({ problems: list });
  };

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><a href="#/admin/contests" className="small">← Contests</a><h1>New contest</h1><p>Fill four steps; the wizard creates, checks and schedules the contest for you.</p></div>
        <button className="ghost small" onClick={() => { if (confirm("Discard this draft?")) { setD({ ...EMPTY, startsAt: nextHour() }); setStep(0); setCreated(null); setLog([]); } }}>Start over</button>
      </div>
      <Steps steps={STEPS} current={step} onSelect={setStep} />
      <section className="card">
        {step === 0 && (
          <div className="stack">
            <div className="contest-kinds" role="radiogroup" aria-label="Contest type">
              {([["STANDARD", "Standard contest", "A timed contest of a few hours. Full screen in the arena."],
                 ["WARMUP", "Warmup (several days)", "New problems open every day. Best submission counts, no time penalty, no full screen."]] as const).map(([kind, name, text]) => (
                <button key={kind} type="button" role="radio" aria-checked={d.kind === kind} disabled={Boolean(created)} className={"card-flat" + (d.kind === kind ? " active" : "")}
                  onClick={() => set({ kind, rules: d.rules === RULES || d.rules === WARMUP_RULES ? (kind === "WARMUP" ? WARMUP_RULES : RULES) : d.rules })}>
                  <strong>{name}</strong><span className="small muted">{text}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-2">
              <Field label="Contest name"><input autoFocus value={d.title} onChange={(e) => set({ title: e.target.value, slug: created ? d.slug : slugify(e.target.value) })} placeholder="InfoM4th Spring Cup" /></Field>
              <Field label="Short name (URL)"><input value={d.slug} disabled={Boolean(created)} onChange={(e) => set({ slug: e.target.value })} /></Field>
              <Field label="Format"><select value={d.mode} onChange={(e) => set({ mode: e.target.value as Draft["mode"] })}><option value="INDIVIDUAL">Individual</option><option value="TEAM">Teams</option></select></Field>
              {d.mode === "TEAM" && <Field label="Max team size"><input type="number" min={1} max={10} value={d.maxTeamSize} onChange={(e) => set({ maxTeamSize: Number(e.target.value) })} /></Field>}
              {warmup ? (
                <Field label="Number of days" hint="Day N's problems open N − 1 days after the start, at the same time of day.">
                  <input type="number" min={1} max={31} value={d.days} onChange={(e) => set({ days: Number(e.target.value) })} />
                </Field>
              ) : (
                <Field label="Duration"><div className="row" style={{ flexWrap: "nowrap" }}>
                  <input type="number" min={0} max={24} value={d.hours} onChange={(e) => set({ hours: Number(e.target.value) })} /><span>h</span>
                  <input type="number" min={0} max={59} value={d.minutes} onChange={(e) => set({ minutes: Number(e.target.value) })} /><span>min</span></div></Field>
              )}
              {warmup && <Field label="Scoring" hint={SCORING_INFO.IOI.summary}><input value="Best submission on each problem" disabled /></Field>}
              {!warmup && <Field label="Freeze scoreboard before the end (minutes)" hint="0 = never freeze"><input type="number" min={0} value={d.freezeMinutes} onChange={(e) => set({ freezeMinutes: Number(e.target.value) })} /></Field>}
              {!warmup && <Field label="Scoring system" hint={SCORING_INFO[d.scoring].summary}>
                <select value={d.scoring} onChange={(e) => set({ scoring: e.target.value as Draft["scoring"], points: {} })}>
                  <option value="ICPC">ICPC — solved count, then time + penalty</option>
                  <option value="IOI">IOI — partial points per test passed</option>
                  <option value="CODEFORCES">Codeforces — points decrease over time</option>
                  <option value="ATCODER">AtCoder — fixed points, time tie-break</option>
                </select>
              </Field>}
              {!warmup && d.scoring === "ICPC" && <Field label="Penalty per rejected attempt (minutes)"><input type="number" min={0} value={d.penaltyMinutes} onChange={(e) => set({ penaltyMinutes: Number(e.target.value) })} /></Field>}
              <Field label="Languages"><LanguagePicker value={d.languages} onChange={(languages) => set({ languages })} /></Field>
            </div>
            {warmup && <label className="check small"><input type="checkbox" checked={d.publishToPractice} onChange={(e) => set({ publishToPractice: e.target.checked })} />When the warmup ends, publish its problems in Practice so everyone can keep solving them</label>}
            {!warmup && d.scoring !== "IOI" && <label className="check small"><input type="checkbox" checked={d.penalizeCompilationErrors} onChange={(e) => set({ penalizeCompilationErrors: e.target.checked })} />Compilation errors also count as rejected attempts</label>}
            <Field label="Description shown in the lobby (Markdown)"><textarea rows={3} value={d.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <Field label="Rules (Markdown)"><textarea rows={4} value={d.rules} onChange={(e) => set({ rules: e.target.value })} /></Field>
          </div>
        )}
        {step === 1 && (
          <div className="grid grid-2" style={{ alignItems: "start" }}>
            <div className="stack">
              <div className="row-between"><strong>Approved problems</strong><a className="small" href="#/admin/problems/new">+ Create a problem</a></div>
              {lab.loading ? <Loading /> : approved.length === 0 ? <Empty>No approved problems yet. Create one with the problem wizard first.</Empty> : approved.map((p) => (
                <label key={p.version_id} className="check card-flat" style={{ justifyContent: "space-between" }}>
                  <span className="row"><input type="checkbox" disabled={Boolean(created)} checked={d.problems.includes(p.version_id)}
                    onChange={(e) => set({ problems: e.target.checked ? [...d.problems, p.version_id] : d.problems.filter((x) => x !== p.version_id) })} />{p.title}</span>
                  <span className="small muted mono">{p.slug}</span>
                </label>
              ))}
            </div>
            <div className="stack">
              <strong>Contest problem set ({d.problems.length})</strong>
              {warmup && d.problems.length > 0 && emptyDays.length > 0 && <div className="notice warn small">No problems on day {emptyDays.join(", ")} yet.</div>}
              {d.problems.length === 0 ? <Empty>Tick problems on the left. Order them here; letters are assigned automatically.</Empty> : ordered.map((v, i) => (
                <div key={v} className="row-between card-flat">
                  <span className="row"><span className="problem-letter">{label(i)}</span>{titles[v] ?? v}</span>
                  {warmup && <label className="row small" style={{ flexWrap: "nowrap" }}>Day <select style={{ width: "auto" }} disabled={Boolean(created)} value={dayOf(v)}
                    onChange={(e) => set({ dayOf: { ...d.dayOf, [v]: Number(e.target.value) } })} aria-label={"Day for " + (titles[v] ?? v)}>
                    {Array.from({ length: d.days }, (_, k) => <option key={k} value={k + 1}>{k + 1}</option>)}</select></label>}
                  {!warmup && d.scoring !== "ICPC" && <label className="row small" style={{ flexWrap: "nowrap" }}>points <input type="number" min={1} max={100000} style={{ width: 90 }} disabled={Boolean(created)}
                    value={d.points[v] ?? defaultPoints(d.scoring, i)} onChange={(e) => set({ points: { ...d.points, [v]: Number(e.target.value) } })} /></label>}
                  {!created && <span className="row"><button className="small ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</button><button className="small ghost" onClick={() => move(i, 1)} disabled={i === d.problems.length - 1}>↓</button></span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {step === 2 && (d.mode === "TEAM" ? (
          <div className="notice">Team contests are entered by team captains from the Teams page and the contest lobby after scheduling.</div>
        ) : (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>Optional. Public contests also allow self-registration in the lobby. Private contests only admit the people you add here.</p>
            <Field label="Handles or emails (one per line, or separated by commas)" hint={handles.length + " entered. Create missing accounts first in Users → Import users."}>
              <textarea rows={8} className="mono" value={d.participants} onChange={(e) => set({ participants: e.target.value })} placeholder={"contestant1\nali@example.com"} />
            </Field>
          </div>
        ))}
        {step === 3 && (
          <div className="stack">
            <div className="grid grid-2">
              <Field label={`Start time (${displayTimeZone()})`}><input type="datetime-local" value={d.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
              <Field label="Who can see and join"><select value={d.visibility} onChange={(e) => set({ visibility: e.target.value })}>
                <option value="PUBLIC">Public — listed, anyone can register</option><option value="UNLISTED">Unlisted — link only</option><option value="PRIVATE">Private — only added participants</option></select></Field>
            </div>
            <div className="card-flat small">
              <strong>{d.title || "Untitled"}</strong> · {warmup ? `Warmup · ${d.days} days · best submission scoring` : `${SCORING_INFO[d.scoring].name} scoring`} · {d.mode === "TEAM" ? "teams" : "individual"}{warmup ? "" : ` · ${d.hours}h ${d.minutes}m`} · {d.problems.length} problems ({d.problems.map((_, i) => label(i)).join(", ")}) ·
              {" "}{handles.length} pre-registered · starts {!Number.isNaN(fromZoneInput(d.startsAt)) ? when(startIso(d.startsAt)) : "—"} · ends {!Number.isNaN(fromZoneInput(d.startsAt)) ? when(new Date(fromZoneInput(d.startsAt) + duration * 1000).toISOString()) : "—"}
            </div>
            {issues.length > 0 && <div className="notice warn"><ul className="small" style={{ margin: 0 }}>{issues.map((i) => <li key={i}>{i}</li>)}</ul></div>}
            {!(fromZoneInput(d.startsAt) >= serverNow() + 60_000) && <div className="notice warn small">To schedule, pick a start time in the future — or use “Create & start now”.</div>}
            <div className="row">
              <button className="primary" disabled={busy || issues.length > 0} onClick={() => finish(true, true)}>▶ Create & start now</button>
              <button className="primary" disabled={busy || issues.length > 0 || !(fromZoneInput(d.startsAt) >= serverNow() + 60_000)} onClick={() => finish(true)}>Create & schedule</button>
              <button disabled={busy || issues.length > 0} onClick={() => finish(false)}>Save as draft</button>
              {created && <a className="btn ghost" href={"#/admin/contests/" + created}>Open contest page</a>}
            </div>
            <ProgressLog lines={log} />
            {log.some((l) => l.state === "error") && created && <div className="notice small">The contest was created. Fix the issue above, then finish from the contest page or click “Create & schedule” again.</div>}
          </div>
        )}
        <StepNav current={step} last={STEPS.length - 1} onBack={() => setStep(step - 1)} onNext={() => setStep(step + 1)} nextDisabled={step === 0 && (!d.title.trim() || !d.slug)} />
      </section>
      {created && <span className="small muted">Settings can still be edited on the contest page before scheduling. <Badge>draft saved on server</Badge></span>}
    </div>
  );
}
