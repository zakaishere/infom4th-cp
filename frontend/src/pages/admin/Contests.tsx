import { useState } from "react";
import { del, patch, post } from "../../api";
import { navigate, useAction, useData, useServerClock, useToast } from "../../app";
import { SubmissionModal } from "../../components/Problem";
import Standings from "../../components/Standings";
import { Badge, Empty, ErrorBox, Field, LANGUAGE_NAMES, LiveDot, Loading, ReasonDialog, Verdict, clock, when } from "../../ui";
import { runPhase } from "../Home";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", INTERNAL_TESTING: "Tested", READY: "Ready", SCHEDULED: "Scheduled", RUNNING: "Live", FINISHED: "Finished", ARCHIVED: "Archived",
};

const CONTROL_TEXT: Record<string, { title: string; description?: string }> = {
  pause: { title: "Pause submissions", description: "New submissions are refused; queued submissions keep judging. The contest clock does not stop." },
  resume: { title: "Resume submissions" },
  "start-now": { title: "Start now", description: "The contest opens immediately and ends after its configured duration." },
  extend: { title: "Add 10 minutes", description: "The end time moves 10 minutes later for everyone." },
  "end-now": { title: "End the contest now", description: "Submissions stop immediately and the contest is marked finished. This cannot be undone." },
  "end-rehearsal": { title: "End rehearsal" },
  "release-standings": { title: "Release final standings", description: "Unfreezes the public scoreboard so everyone sees the final results." },
};

/** Where the contest is in its life, so organizers always know the next step. */
function Lifecycle({ status, hasProblems }: { status: string; hasProblems: boolean }) {
  const order = ["setup", "launch", "live", "results"];
  const now = status === "RUNNING" ? "live" : status === "FINISHED" || status === "ARCHIVED" ? "results" : status === "SCHEDULED" ? "launch" : hasProblems ? "launch" : "setup";
  const steps: [string, string][] = [["setup", "Add problems & settings"], ["launch", status === "SCHEDULED" ? "Scheduled — waiting for start" : "Launch (start now or schedule)"], ["live", "Live — monitor & answer"], ["results", "Results"]];
  const at = order.indexOf(now);
  return (
    <ol className="lifecycle" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
      {steps.map(([key, label], i) => <li key={key} className={i < at ? "done" : i === at ? "now" : ""}><b>{i < at ? "✓" : i + 1}</b>{label}</li>)}
    </ol>
  );
}

type Competition = { id: string; slug: string; title: string; status: string; visibility: string; published_at: string | null; created_at: string };

export function ContestList() {
  const list = useData<Competition[]>("/api/manage/competitions");
  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Organizer</div><h1>Contests</h1>
          <p>The wizard creates, checks and schedules a contest in four steps. Open a contest to monitor it live.</p></div>
        <button className="primary" onClick={() => navigate("/admin/contests/new")}>+ New contest</button>
      </div>
      <ErrorBox error={list.error} />
      {list.loading ? <Loading /> : !list.data?.length ? <Empty>No contests yet.</Empty> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Contest</th><th>Status</th><th>Visibility</th><th>Created</th><th /></tr></thead>
            <tbody>{list.data.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.title}</strong><div className="small muted mono">{c.slug}</div></td>
                <td>{c.status === "RUNNING" && <LiveDot />} <Badge tone={c.status === "RUNNING" ? "ok" : c.status === "SCHEDULED" ? "info" : "neutral"}>{STATUS_LABEL[c.status] ?? c.status}</Badge></td>
                <td className="small">{c.visibility}</td>
                <td className="small">{when(c.created_at)}</td>
                <td className="right"><a className={"btn small" + (c.status === "RUNNING" ? " primary" : "")} href={"#/admin/contests/" + c.id}>{c.status === "RUNNING" ? "Monitor" : "Manage"}</a></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Run = { id: string; kind: string; status: string; starts_at: string; ends_at: string; submissions_paused: boolean; final_standings_released_at: string | null };
type Detail = Competition & {
  version: { id: string; sealed_at: string | null; duration_seconds: number; mode: string; description_md: string; rules_md: string; freeze_before_end_seconds: number; wrong_attempt_penalty_seconds: number };
  problems: { slot: number; label: string; problem_version_id: string }[];
  runs: Run[];
};

export function ContestDetail({ id }: { id: string }) {
  const d = useData<Detail>("/api/manage/competitions/" + id, 15000);
  const readiness = useData<{ ready: boolean; errors: string[] }>("/api/manage/competitions/" + id + "/readiness", 15000);
  const lab = useData<{ version_id: string; title: string; slug: string; status: string }[]>("/api/lab/problems");
  const [attach, setAttach] = useState({ versionId: "", label: "" });
  const [startsAt, setStartsAt] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [launchNow, setLaunchNow] = useState(true);
  const [controlRun, setControlRun] = useState<{ id: string; action: string } | null>(null);
  const { busy, run } = useAction();
  if (d.loading) return <Loading />;
  if (!d.data) return <ErrorBox error={d.error} />;
  const c = d.data, sealed = Boolean(c.version.sealed_at);
  const approved = (lab.data ?? []).filter((p) => p.status === "APPROVED" || p.status === "PUBLISHED");
  const titles = Object.fromEntries((lab.data ?? []).map((p) => [p.version_id, p.title]));
  const official = c.runs.find((r) => r.kind === "OFFICIAL");
  const active = selectedRun ?? official?.id ?? c.runs[0]?.id ?? null;
  const refresh = () => { d.reload(); readiness.reload(); };
  // Once the official run starts, the live monitor is what organizers need first.
  const started = ["RUNNING", "FINISHED"].includes(c.status) || (official ? official.status !== "PENDING" : false);
  const monitor = active ? <RunMonitor key={active} run={c.runs.find((r) => r.id === active)!} problems={c.problems} onChanged={refresh} /> : null;
  const setup = (
    <>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="card stack">
          <h3>Problems</h3>
          {c.problems.length === 0 ? <Empty>Attach approved problems.</Empty> : (
            <table><tbody>{c.problems.map((p) => (
              <tr key={p.slot}><td><span className="problem-letter">{p.label}</span></td><td>{titles[p.problem_version_id] ?? <span className="mono small">{p.problem_version_id}</span>}</td>
                <td className="right">{!sealed && <button className="small danger" onClick={() => run(async () => { await del("/api/manage/competitions/" + id + "/problems/" + p.slot); refresh(); })}>Remove</button>}</td></tr>
            ))}</tbody></table>
          )}
          {!sealed && (
            <form className="row" style={{ alignItems: "flex-end" }} onSubmit={(e) => {
              e.preventDefault();
              const slot = (c.problems.reduce((m, p) => Math.max(m, p.slot), 0)) + 1;
              run(async () => { await post("/api/manage/competitions/" + id + "/problems", { versionId: attach.versionId, slot, label: attach.label || String.fromCharCode(64 + slot) }); setAttach({ versionId: "", label: "" }); refresh(); }, "Problem attached");
            }}>
              <Field label="Approved problem"><select required value={attach.versionId} onChange={(e) => setAttach({ ...attach, versionId: e.target.value })}>
                <option value="">Choose…</option>{approved.map((p) => <option key={p.version_id} value={p.version_id}>{p.title} ({p.slug})</option>)}</select></Field>
              <Field label="Label"><input maxLength={8} placeholder="auto" value={attach.label} onChange={(e) => setAttach({ ...attach, label: e.target.value })} style={{ width: 80 }} /></Field>
              <button disabled={busy}>Attach</button>
            </form>
          )}
          {!sealed && <SettingsForm d={c} onSaved={refresh} />}
        </section>

        <section className="card stack accent">
          <h3>Launch</h3>
          {readiness.data && (readiness.data.ready
            ? <div className="notice ok small">Ready to go: problems are approved and validated, and judges are online for every language.</div>
            : <div className="notice warn"><strong>Fix these first</strong><ul className="small">{readiness.data.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>)}
          {!official ? (
            <form className="stack" onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                // A contest must pass one private rehearsal before it can go public; do it automatically.
                if (c.status === "DRAFT") {
                  let teamIds: string[] | undefined;
                  if (c.version.mode === "TEAM") teamIds = [(await post<{ teamId: string }>("/api/teams", { name: ("Jury " + c.slug).slice(0, 100) })).teamId];
                  const reh = await post<{ runId: string }>("/api/manage/competitions/" + id + "/rehearsals", teamIds ? { teamIds } : {});
                  await post("/api/manage/runs/" + reh.runId + "/control", { action: "end-rehearsal", reason: "Automatic pre-launch check" });
                }
                await post("/api/manage/competitions/" + id + "/schedule", launchNow ? { startNow: true, visibility, reason: "Started from the contest page" } : { startsAt: new Date(startsAt).toISOString(), visibility });
                refresh();
              }, launchNow ? "The contest is live!" : "Contest scheduled and published");
            }}>
              <div className="launch">
                <button type="button" className={"option" + (launchNow ? " active" : "")} onClick={() => setLaunchNow(true)}>
                  <strong>▶ Start now</strong><span className="small muted">Opens immediately and ends after {Math.round(c.version.duration_seconds / 60)} minutes. People can still join while it runs.</span>
                </button>
                <button type="button" className={"option" + (!launchNow ? " active" : "")} onClick={() => setLaunchNow(false)}>
                  <strong>🗓 Schedule for later</strong><span className="small muted">Publish now with a countdown; contestants register before the start.</span>
                </button>
              </div>
              <div className="grid grid-2">
                {!launchNow && <Field label="Start (your local time)"><input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>}
                <Field label="Who can see it"><select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  <option value="PUBLIC">Public: listed for everyone</option><option value="UNLISTED">Unlisted: link only</option><option value="PRIVATE">Private: invited users only</option></select></Field>
              </div>
              <div><button className="primary" disabled={busy || !readiness.data?.ready || c.problems.length === 0}>{launchNow ? "▶ Start the contest now" : "Publish & schedule"}</button></div>
              <span className="small muted">The configuration is locked once published. A private test run happens automatically first.</span>
            </form>
          ) : official.status === "PENDING" ? (
            <div className="stack">
              <div className="notice">Scheduled for <strong>{when(official.starts_at)}</strong> (starts in {clock(new Date(official.starts_at).getTime() - Date.now())}).</div>
              <div><button className="primary" disabled={busy} onClick={() => setControlRun({ id: official.id, action: "start-now" })}>▶ Start now instead</button></div>
            </div>
          ) : <div className="notice small">The official contest {official.status === "RUNNING" ? "is running" : "has finished"}.</div>}
          <details>
            <summary className="small"><strong>Rehearsals</strong> — try the contest privately as a contestant</summary>
            <div className="stack" style={{ marginTop: "0.6rem" }}>
              <div><button className="small" disabled={busy || c.problems.length === 0 || ["SCHEDULED", "RUNNING", "FINISHED"].includes(c.status)}
                onClick={() => run(async () => { const r = await post("/api/manage/competitions/" + id + "/rehearsals", {}); setSelectedRun(r.runId); refresh(); }, "Rehearsal started (you are the entrant)")}>Start a rehearsal</button></div>
              {c.runs.length > 0 && (
                <div className="stack" style={{ gap: "0.4rem" }}>{c.runs.map((r) => (
                  <button key={r.id} className={"small" + (active === r.id ? " primary" : "")} style={{ justifyContent: "space-between" }} onClick={() => setSelectedRun(r.id)}>
                    <span>{r.kind === "OFFICIAL" ? "Official" : "Rehearsal"} · {when(r.starts_at)}</span><span className="small">{r.status}</span>
                  </button>
                ))}</div>
              )}
            </div>
          </details>
        </section>
      </div>

      <Participants id={id} mode={c.version.mode} status={c.status} />
    </>
  );
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <a href="#/admin/contests" className="small">← Contests</a>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>{c.title}</h1>
          <div className="row"><Badge tone={c.status === "RUNNING" ? "ok" : "info"}>{STATUS_LABEL[c.status] ?? c.status}</Badge><span className="tag">{c.version.mode === "TEAM" ? "Teams" : "Individual"}</span>{sealed && <span className="tag">Locked</span>}<span className="small muted">{Math.round(c.version.duration_seconds / 60)} min · {c.problems.length} problems</span></div></div>
        {sealed && !official && <button disabled={busy} onClick={() => run(async () => { await post("/api/manage/competitions/" + id + "/clone-version"); refresh(); }, "Editable configuration created")}>Clone configuration to edit</button>}
      </div>

      <Lifecycle status={c.status} hasProblems={c.problems.length > 0} />
      {started && monitor}
      {started ? (
        <details className="card">
          <summary><strong>Contest setup</strong> <span className="small muted">— problems, readiness, runs and participants (locked once the contest starts)</span></summary>
          <div className="stack" style={{ marginTop: "1rem" }}>{setup}</div>
        </details>
      ) : setup}
      {!started && monitor}
      {controlRun && <ReasonDialog title="Start the contest now" confirm="Start now"
        description="The contest opens immediately and ends after its configured duration. Registered entrants see the problems at once."
        onClose={() => setControlRun(null)}
        onSubmit={(reason) => run(async () => { await post("/api/manage/runs/" + controlRun.id + "/control", { action: controlRun.action, reason }); setControlRun(null); refresh(); }, "The contest is live!")} />}
    </div>
  );
}

function SettingsForm({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const [f, setF] = useState({ title: d.title, description: d.version.description_md, rules: d.version.rules_md,
    durationMinutes: Math.round(d.version.duration_seconds / 60), freezeMinutes: Math.round(d.version.freeze_before_end_seconds / 60), penaltyMinutes: Math.round(d.version.wrong_attempt_penalty_seconds / 60) });
  const { busy, run } = useAction();
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      run(async () => { await patch("/api/manage/competitions/" + d.id, { title: f.title, description: f.description, rules: f.rules, durationSeconds: f.durationMinutes * 60, freezeBeforeEndSeconds: f.freezeMinutes * 60, wrongAttemptPenaltySeconds: f.penaltyMinutes * 60 }); onSaved(); }, "Contest settings saved");
    }}>
      <hr style={{ margin: "0.5rem 0" }} />
      <h3>Settings</h3>
      <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <div className="grid grid-3">
        <Field label="Duration (min)"><input type="number" min={1} value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: Number(e.target.value) })} /></Field>
        <Field label="Freeze before end (min)"><input type="number" min={0} value={f.freezeMinutes} onChange={(e) => setF({ ...f, freezeMinutes: Number(e.target.value) })} /></Field>
        <Field label="Penalty per rejection (min)"><input type="number" min={0} value={f.penaltyMinutes} onChange={(e) => setF({ ...f, penaltyMinutes: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Description (Markdown)"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Rules (Markdown)"><textarea rows={3} value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} /></Field>
      <div><button disabled={busy}>Save settings</button></div>
    </form>
  );
}

type JurySubmission = { id: string; entry_name: string; handle: string; problem_slot: number; language_code: string; submitted_at: string; status: string; verdict: string | null; execution_time_ms: number | null; passed_tests: number | null; total_tests: number | null; generation: number };
type Clarification = { id: string; question: string; answer: string | null; is_public: boolean; created_at: string };

function RunMonitor({ run: r, problems, onChanged }: { run: Run; problems: { slot: number; label: string }[]; onChanged: () => void }) {
  const [tab, setTab] = useState<"submissions" | "standings" | "clarifications" | "announce">("submissions");
  const subs = useData<JurySubmission[]>("/api/manage/runs/" + r.id + "/submissions", 3000);
  const clar = useData<Clarification[]>("/api/runs/" + r.id + "/clarifications", 5000);
  const now = useServerClock();
  const phase = runPhase(now, r.starts_at, r.ends_at);
  const labels = Object.fromEntries(problems.map((p) => [p.slot, p.label]));
  const [control, setControl] = useState<string | null>(null);
  const [rejudge, setRejudge] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [answers, setAnswers] = useState<Record<string, { text: string; public: boolean }>>({});
  const [announce, setAnnounce] = useState({ title: "", body: "" });
  const { busy, run } = useAction();
  const open_ = (clar.data ?? []).filter((c) => !c.answer).length;
  const rows = (subs.data ?? []).filter((s) => !filter || (s.entry_name + " " + s.handle + " " + labels[s.problem_slot]).toLowerCase().includes(filter.toLowerCase()));
  const counts = (subs.data ?? []).reduce((acc, s) => { const k = s.verdict ?? (s.status === "RUNNING" ? "RUNNING" : "WAITING"); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  return (
    <section className="card stack" style={{ padding: 0 }}>
      <div className="control-bar">
        <div className="stack" style={{ gap: 0 }}>
          <span className="eyebrow">{r.kind === "OFFICIAL" ? "Official contest" : "Rehearsal"} · {phase.phase === "live" ? "live" : phase.phase === "upcoming" ? "starts in" : "finished"}</span>
          <span className="row">{phase.phase === "live" && <LiveDot />}<span className="clock">{phase.phase === "ended" ? "Ended" : clock(phase.ms)}</span></span>
        </div>
        {r.submissions_paused && <Badge tone="warn">Submissions paused</Badge>}
        {r.final_standings_released_at && <Badge tone="ok">Final standings released</Badge>}
        <span className="spacer" />
        {phase.phase === "upcoming" && r.kind === "OFFICIAL" && <button className="primary" onClick={() => setControl("start-now")}>▶ Start now</button>}
        {phase.phase !== "ended" && (r.submissions_paused ? <button onClick={() => setControl("resume")}>Resume submissions</button> : phase.phase === "live" && <button className="danger" onClick={() => setControl("pause")}>Pause submissions</button>)}
        {phase.phase !== "ended" && <button onClick={() => setControl("extend")}>+10 min</button>}
        {phase.phase === "live" && r.kind === "OFFICIAL" && <button className="danger" onClick={() => setControl("end-now")}>End now</button>}
        {r.kind === "REHEARSAL" && r.status !== "FINISHED" && <button onClick={() => setControl("end-rehearsal")}>End rehearsal</button>}
        {phase.phase === "ended" && !r.final_standings_released_at && <button className="primary" onClick={() => setControl("release-standings")}>Release final standings</button>}
        <a className="btn" href={"#/arena/" + r.id}>Open arena</a>
      </div>
      <div className="stack" style={{ padding: "0 1.25rem 1.25rem" }}>
      <div className="row small">{Object.entries(counts).map(([k, v]) => <Badge key={k} tone={k === "ACCEPTED" ? "ok" : k === "WAITING" || k === "RUNNING" ? "info" : "neutral"}>{k.replace(/_/g, " ")}: {v}</Badge>)}</div>
      <div className="tabs">
        <button className={tab === "submissions" ? "active" : ""} onClick={() => setTab("submissions")}>Submissions</button>
        <button className={tab === "standings" ? "active" : ""} onClick={() => setTab("standings")}>Jury standings</button>
        <button className={tab === "clarifications" ? "active" : ""} onClick={() => setTab("clarifications")}>Clarifications{open_ ? ` (${open_} open)` : ""}</button>
        <button className={tab === "announce" ? "active" : ""} onClick={() => setTab("announce")}>Announce</button>
      </div>
      {tab === "submissions" && (
        <>
          <input placeholder="Filter by entrant, handle or problem" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 360 }} />
          {subs.loading ? <Loading /> : rows.length === 0 ? <Empty>No submissions.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Time</th><th>Entrant</th><th>Problem</th><th>Lang</th><th>Verdict</th><th className="right">Tests</th><th className="right">Time</th><th /></tr></thead>
              <tbody>{rows.map((s) => (
                <tr key={s.id}>
                  <td className="small">{new Date(s.submitted_at).toLocaleTimeString()}</td>
                  <td>{s.entry_name}<div className="small muted">@{s.handle}</div></td>
                  <td><strong>{labels[s.problem_slot] ?? s.problem_slot}</strong></td>
                  <td className="small">{LANGUAGE_NAMES[s.language_code] ?? s.language_code}</td>
                  <td><Verdict status={s.status} verdict={s.verdict} />{s.generation > 1 && <span className="small muted"> (rejudge {s.generation - 1})</span>}</td>
                  <td className="right small mono">{s.total_tests ? `${s.passed_tests}/${s.total_tests}` : ""}</td>
                  <td className="right small mono">{s.execution_time_ms != null ? s.execution_time_ms + " ms" : ""}</td>
                  <td className="right"><div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <button className="small ghost" onClick={() => setOpen(s.id)}>Source</button>
                    <button className="small" disabled={s.status === "QUEUED" || s.status === "RUNNING" || s.status === "RETRY"} onClick={() => setRejudge(s.id)}>Rejudge</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      {tab === "standings" && <Standings runId={r.id} labels={labels} jury />}
      {tab === "clarifications" && (
        <div className="stack">
          {(clar.data ?? []).length === 0 ? <Empty>No questions.</Empty> : (clar.data ?? []).map((c) => (
            <div key={c.id} className="card-flat stack">
              <div className="row-between small muted"><span>{new Date(c.created_at).toLocaleTimeString()}</span>{c.answer ? <Badge tone="ok">{c.is_public ? "Answered publicly" : "Answered"}</Badge> : <Badge tone="warn">Open</Badge>}</div>
              <div><strong>Q:</strong> {c.question}</div>
              {c.answer ? <div><strong>A:</strong> {c.answer}</div> : (
                <form className="stack" onSubmit={(e) => {
                  e.preventDefault();
                  const a = answers[c.id];
                  run(async () => { await post("/api/manage/clarifications/" + c.id + "/answer", { answer: a.text, public: a.public }); clar.reload(); }, "Answer sent");
                }}>
                  <textarea required placeholder="Answer" value={answers[c.id]?.text ?? ""} onChange={(e) => setAnswers({ ...answers, [c.id]: { text: e.target.value, public: answers[c.id]?.public ?? false } })} />
                  <div className="row">
                    <label className="check small"><input type="checkbox" checked={answers[c.id]?.public ?? false} onChange={(e) => setAnswers({ ...answers, [c.id]: { text: answers[c.id]?.text ?? "", public: e.target.checked } })} />Visible to everyone</label>
                    <button className="small" type="button" onClick={() => setAnswers({ ...answers, [c.id]: { text: "No comment. Please read the statement carefully.", public: false } })}>“No comment”</button>
                    <button className="primary small" disabled={busy}>Send answer</button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "announce" && (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          run(async () => { await post("/api/manage/runs/" + r.id + "/announcements", announce); setAnnounce({ title: "", body: "" }); }, "Announcement published to all entrants");
        }}>
          <Field label="Title"><input required maxLength={255} value={announce.title} onChange={(e) => setAnnounce({ ...announce, title: e.target.value })} /></Field>
          <Field label="Message (Markdown)"><textarea required rows={4} value={announce.body} onChange={(e) => setAnnounce({ ...announce, body: e.target.value })} /></Field>
          <div><button className="primary" disabled={busy}>Publish announcement</button></div>
        </form>
      )}
      {control && (
        <ReasonDialog title={CONTROL_TEXT[control]?.title ?? control} confirm={CONTROL_TEXT[control]?.title}
          danger={control === "pause" || control === "end-now"} onClose={() => setControl(null)}
          description={CONTROL_TEXT[control]?.description}
          onSubmit={(reason) => run(async () => { await post("/api/manage/runs/" + r.id + "/control", control === "extend" ? { action: control, reason, minutes: 10 } : { action: control, reason }); setControl(null); onChanged(); }, "Done")} />
      )}
      {rejudge && (
        <ReasonDialog title="Rejudge submission" confirm="Rejudge" onClose={() => setRejudge(null)}
          description="A new judging generation is created; the source is unchanged and standings use the newest result."
          onSubmit={(reason) => run(async () => { await post("/api/manage/submissions/" + rejudge + "/rejudge", { reason }); setRejudge(null); subs.reload(); }, "Rejudge queued")} />
      )}
      {open && <SubmissionModal id={open} onClose={() => setOpen(null)} />}
      </div>
    </section>
  );
}

function Participants({ id, mode, status }: { id: string; mode: string; status: string }) {
  const list = useData<{ id: string; handle: string | null; display_name: string | null; email: string | null; team: string | null; status: string }[]>("/api/manage/competitions/" + id + "/participants", 20000);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();
  const closed = ["RUNNING", "FINISHED", "ARCHIVED"].includes(status);
  return (
    <section className="card stack">
      <div className="row-between">
        <h3 style={{ margin: 0 }}>Participants ({list.data?.length ?? "…"})</h3>
        <button className="small" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show list"}</button>
      </div>
      {mode === "INDIVIDUAL" && !closed && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Add by handle or email" hint="Several at once: one per line or comma separated. Create accounts first in Users → Import users.">
            <textarea rows={2} className="mono" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <button className="primary" disabled={busy || !text.trim()} onClick={() => run(async () => {
            const result = await post<{ user: string; status: string }[]>("/api/manage/competitions/" + id + "/participants", { users: text.split(/[\s,;]+/).filter(Boolean) });
            const failed = result.filter((r) => r.status !== "REGISTERED");
            toast(failed.length ? "info" : "success", (result.length - failed.length) + " registered" + (failed.length ? "; " + failed.map((f) => f.user + " " + f.status.toLowerCase().replace(/_/g, " ")).join(", ") : ""));
            setText(""); list.reload();
          })}>Register</button>
        </div>
      )}
      {mode === "TEAM" && <span className="small muted">Team captains register their teams from the contest lobby.</span>}
      {open && (list.loading ? <Loading /> : !list.data?.length ? <Empty>No registrations yet.</Empty> : (
        <div className="table-wrap"><table><thead><tr><th>Participant</th><th>Email</th><th>Status</th><th>Registered</th></tr></thead>
          <tbody>{list.data.map((p) => <tr key={p.id}><td>{p.team ?? p.display_name}<div className="small muted">{p.handle ? "@" + p.handle : ""}</div></td><td className="small">{p.email ?? ""}</td><td><Badge tone="ok">{p.status}</Badge></td><td className="small">{when((p as any).created_at)}</td></tr>)}</tbody></table></div>
      ))}
    </section>
  );
}
