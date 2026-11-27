import { useEffect, useMemo, useState } from "react";
import { del, patch, post, serverNow } from "../../api";
import { navigate, useAction, useData, useRoute, useServerClock, useToast } from "../../app";
import { FullscreenPanel, type FullscreenData } from "../../components/FullscreenLog";
import { SearchSelect } from "../../components/SearchSelect";
import { SubmissionModal } from "../../components/Problem";
import Standings from "../../components/Standings";
import { DifficultyPill } from "../Practice";
import { Badge, CONTEST_FORMAT_LABEL, Empty, ErrorBox, Field, LANGUAGE_NAMES, LiveDot, Loading, ReasonDialog, UserLink, Verdict, clock, formatDuration, fromZoneInput, localTimeZone, timeOf, toZoneInput, when } from "../../ui";
import { runPhase } from "../Home";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", INTERNAL_TESTING: "Tested", READY: "Ready", SCHEDULED: "Waiting to start", RUNNING: "Live", FINISHED: "Finished", ARCHIVED: "Archived",
};

const CONTROL_TEXT: Record<string, { title: string; description?: string }> = {
  pause: { title: "Pause submissions", description: "New submissions are refused; queued submissions keep judging. The contest clock does not stop." },
  resume: { title: "Resume submissions" },
  "start-now": { title: "Start contest now", description: "The contest opens immediately and ends after its configured duration. Registered entrants see the problems at once." },
  extend: { title: "Add 10 minutes", description: "The end time moves 10 minutes later for everyone." },
  "end-now": { title: "End the contest now", description: "Submissions stop immediately and the contest is marked finished. This cannot be undone." },
  "end-rehearsal": { title: "End rehearsal" },
  "release-standings": { title: "Release final standings", description: "Unfreezes the public scoreboard so everyone sees the final results. Public contests then count for Sigma, ratings and profiles." },
};

/** Where the contest is in its life, so organizers always know the next step. */
function Lifecycle({ status, hasProblems }: { status: string; hasProblems: boolean }) {
  const order = ["setup", "launch", "live", "results"];
  const now = status === "RUNNING" ? "live" : status === "FINISHED" || status === "ARCHIVED" ? "results" : status === "SCHEDULED" ? "launch" : hasProblems ? "launch" : "setup";
  const steps: [string, string][] = [
    ["setup", "Add problems & settings"],
    ["launch", status === "SCHEDULED" ? "Registration open — waiting for start" : "Publish & open registration"],
    ["live", "Live — monitor & answer"],
    ["results", "Results"],
  ];
  const at = order.indexOf(now);
  return (
    <ol className="lifecycle" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
      {steps.map(([key, label], i) => <li key={key} className={i < at ? "done" : i === at ? "now" : ""}><b>{i < at ? "✓" : i + 1}</b>{label}</li>)}
    </ol>
  );
}

type ContestFormat = "STANDARD" | "BASIC" | "WARMUP";
type Competition = { id: string; slug: string; title: string; status: string; visibility: string; published_at: string | null; created_at: string; contest_format?: ContestFormat };

export function ContestList() {
  const list = useData<Competition[]>("/api/manage/competitions");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"ALL" | ContestFormat>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "LIVE" | "WAITING" | "DRAFT" | "ENDED">("ALL");
  const [deleting, setDeleting] = useState<Competition | null>(null);
  const { run } = useAction();

  const all = list.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((c) => {
      if (kindFilter !== "ALL" && (c.contest_format ?? "STANDARD") !== kindFilter) return false;
      if (statusFilter === "LIVE" && c.status !== "RUNNING") return false;
      if (statusFilter === "WAITING" && c.status !== "SCHEDULED") return false;
      if (statusFilter === "DRAFT" && !["DRAFT", "INTERNAL_TESTING", "READY"].includes(c.status)) return false;
      if (statusFilter === "ENDED" && !["FINISHED", "ARCHIVED"].includes(c.status)) return false;
      if (q && !(c.title + " " + c.slug).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, kindFilter, statusFilter]);

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Organizer</div>
          <h1>Contests</h1>
          <p>Create, manage, start, monitor, or delete Basic, Warmup, and Normal contests.</p>
        </div>
        <button className="primary" onClick={() => navigate("/admin/contests/new")}>+ New contest</button>
      </div>

      {all.length > 0 && (
        <div className="row-between" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
          <input placeholder="Search contests by title or slug…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 240, maxWidth: 340, flex: "1 1 240px" }} />
          <div className="row" style={{ gap: "0.6rem", flexWrap: "wrap" }}>
            <div className="filters" role="group" aria-label="Category filter">
              {(["ALL", "BASIC", "WARMUP", "STANDARD"] as const).map((k) => (
                <button key={k} type="button" className={kindFilter === k ? "active" : ""} onClick={() => setKindFilter(k)}>
                  {k === "ALL" ? "All types" : CONTEST_FORMAT_LABEL[k]}
                </button>
              ))}
            </div>
            <div className="filters" role="group" aria-label="Status filter">
              {([
                ["ALL", "All"],
                ["LIVE", "Live"],
                ["WAITING", "Waiting"],
                ["DRAFT", "Draft"],
                ["ENDED", "Finished"],
              ] as const).map(([k, lbl]) => (
                <button key={k} type="button" className={statusFilter === k ? "active" : ""} onClick={() => setStatusFilter(k)}>{lbl}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ErrorBox error={list.error} />
      {list.loading ? <Loading /> : all.length === 0 ? (
        <Empty>No contests yet. <button className="primary small" style={{ marginLeft: "0.5rem" }} onClick={() => navigate("/admin/contests/new")}>+ New contest</button></Empty>
      ) : filtered.length === 0 ? (
        <Empty>No contest matches these filters. <button className="ghost small" onClick={() => { setSearch(""); setKindFilter("ALL"); setStatusFilter("ALL"); }}>Reset filters</button></Empty>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr><th>Contest</th><th>Category</th><th>Status</th><th>Visibility</th><th>Created</th><th className="right">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={"#/admin/contests/" + c.id} style={{ color: "inherit", textDecoration: "none" }}>
                      <strong>{c.title}</strong>
                    </a>
                    <div className="small muted mono">{c.slug}</div>
                  </td>
                  <td><span className="tag">{CONTEST_FORMAT_LABEL[c.contest_format ?? "STANDARD"] ?? "Normal"}</span></td>
                  <td>
                    <span className="row" style={{ gap: "0.4rem", flexWrap: "nowrap" }}>
                      {c.status === "RUNNING" && <LiveDot />}
                      <Badge tone={c.status === "RUNNING" ? "ok" : c.status === "SCHEDULED" ? "info" : "neutral"}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                    </span>
                  </td>
                  <td className="small">{c.visibility}</td>
                  <td className="small muted">{when(c.created_at)}</td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: "flex-end", gap: "0.4rem", flexWrap: "nowrap" }}>
                      <a className={"btn small" + (c.status === "RUNNING" || c.status === "SCHEDULED" ? " primary" : "")} href={"#/admin/contests/" + c.id}>
                        {c.status === "RUNNING" ? "Monitor" : "Manage"}
                      </a>
                      <button type="button" className="small danger ghost" onClick={() => setDeleting(c)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleting && (
        <ReasonDialog
          title={`Delete contest: ${deleting.title}`}
          confirm="Delete permanently"
          danger
          description={<>This permanently deletes <strong>{deleting.title}</strong> ({deleting.slug}) along with its runs, registrations, and submissions so you can start fresh. The problems in your Problem Library are not affected.</>}
          onClose={() => setDeleting(null)}
          onSubmit={(reason) => run(async () => {
            await del("/api/manage/competitions/" + deleting.id + (reason ? "?reason=" + encodeURIComponent(reason) : ""));
            setDeleting(null);
            list.reload();
          }, "Contest deleted")}
        />
      )}
    </div>
  );
}

type Run = { id: string; kind: string; status: string; starts_at: string; ends_at: string; manual_start?: boolean; submissions_paused: boolean; final_standings_released_at: string | null };
type Detail = Competition & {
  rated: boolean;
  version: { id: string; sealed_at: string | null; duration_seconds: number; mode: string; description_md: string; rules_md: string; freeze_before_end_seconds: number; wrong_attempt_penalty_seconds: number;
    scoring_system?: "ICPC" | "IOI" | "CODEFORCES" | "ATCODER";
    contest_format?: ContestFormat; publish_to_practice?: boolean; require_fullscreen?: boolean };
  problems: { slot: number; label: string; problem_version_id: string; release_day?: number }[];
  practice_published_at?: string | null;
  runs: Run[];
};

type ManageTab = "problems" | "launch" | "participants" | "monitor";

export function ContestDetail({ id }: { id: string }) {
  const route = useRoute();
  const toast = useToast();
  const d = useData<Detail>("/api/manage/competitions/" + id, 15000);
  const readiness = useData<{ ready: boolean; errors: string[] }>("/api/manage/competitions/" + id + "/readiness", 15000);
  const lab = useData<{ version_id: string; title: string; slug: string; status: string; difficulty?: "EASY" | "MEDIUM" | "HARD"; folder?: string | null }[]>("/api/lab/problems");
  const participantsData = useData<{ id: string; handle: string | null; display_name: string | null; email: string | null; team: string | null; status: string; created_at?: string }[]>("/api/manage/competitions/" + id + "/participants", 20000);

  const [attach, setAttach] = useState({ versionId: "", label: "", releaseDay: 1 });
  const [startsAt, setStartsAt] = useState(() => toZoneInput(serverNow() + 3600_000).slice(0, 14) + "00");
  const [visibility, setVisibility] = useState("PUBLIC");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [launchMode, setLaunchMode] = useState<"manual" | "now" | "scheduled">("manual");
  const [controlRun, setControlRun] = useState<{ id: string; action: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [section, setSection] = useState<ManageTab | null>(route.query.get("tab") === "fullscreen" ? "monitor" : null);
  const { busy, run } = useAction();

  useEffect(() => {
    if (route.query.get("tab") === "fullscreen") setSection("monitor");
  }, [route.query.get("tab")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (d.loading) return <Loading />;
  if (!d.data) return <ErrorBox error={d.error} />;

  const c = d.data;
  const sealed = Boolean(c.version.sealed_at);
  const formatName = CONTEST_FORMAT_LABEL[c.version.contest_format ?? "STANDARD"] ?? "Normal";
  const length = formatDuration(c.version.duration_seconds);
  const maxDays = Math.max(1, Math.ceil(c.version.duration_seconds / 86400));
  const showReleaseDay = c.version.contest_format === "WARMUP" && maxDays > 1;
  const hasStaggeredDays = c.problems.some((p) => (p.release_day ?? 1) > 1);
  const approved = (lab.data ?? []).filter((p) => p.status === "APPROVED" || p.status === "PUBLISHED");
  const byVersion = Object.fromEntries((lab.data ?? []).map((p) => [p.version_id, p]));
  const official = c.runs.find((r) => r.kind === "OFFICIAL");
  const activeRunId = selectedRun ?? official?.id ?? c.runs[0]?.id ?? null;
  const activeRun = activeRunId ? c.runs.find((r) => r.id === activeRunId) ?? null : null;
  const refresh = () => { d.reload(); readiness.reload(); participantsData.reload(); };

  const started = ["RUNNING", "FINISHED"].includes(c.status) || (official ? official.status !== "PENDING" : false);
  const waitingToStart = Boolean(official && official.status === "PENDING" && !started);
  const canEditProblems = !sealed || waitingToStart;
  const defaultTab: ManageTab = started && activeRun ? "monitor" : "problems";
  const activeTab: ManageTab = section ?? defaultTab;
  const sortedProblems = [...c.problems].sort((a, b) => (a.release_day ?? 1) - (b.release_day ?? 1) || a.slot - b.slot);

  const copyLobbyLink = () => {
    if (!official) return;
    const url = window.location.origin + window.location.pathname + "#/run/" + official.id;
    navigator.clipboard?.writeText(url).then(() => toast("success", "Lobby link copied to clipboard")).catch(() => toast("info", url));
  };

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="row-between">
        <a href="#/admin/contests" className="small">← All contests</a>
        <div className="row" style={{ gap: "0.5rem" }}>
          {official && <a className="btn small ghost" href={"#/run/" + official.id}>Open lobby</a>}
          {official && <a className="btn small ghost" href={"#/arena/" + official.id}>Preview arena</a>}
          {sealed && !official && (
            <button className="small" disabled={busy} onClick={() => run(async () => { await post("/api/manage/competitions/" + id + "/clone-version"); refresh(); }, "Editable configuration created")}>
              Clone configuration to edit
            </button>
          )}
          <button type="button" className="small danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete contest</button>
        </div>
      </div>

      {/* Header */}
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 style={{ marginBottom: "0.35rem" }}>{c.title}</h1>
          <div className="row" style={{ gap: "0.45rem" }}>
            <Badge tone={c.status === "RUNNING" ? "ok" : c.status === "SCHEDULED" ? "info" : "neutral"}>
              {waitingToStart && official?.manual_start ? "Registration open" : (STATUS_LABEL[c.status] ?? c.status)}
            </Badge>
            <span className="tag">{formatName}</span>
            <span className="tag">{c.version.mode === "TEAM" ? "Teams" : "Individual"}</span>
            <span className="tag">{c.version.scoring_system ?? "ICPC"}</span>
            <span className="small muted">
              {length} · {c.problems.length} problem{c.problems.length === 1 ? "" : "s"}
              {c.version.publish_to_practice ? (c.practice_published_at ? " · in Problem Set" : " · goes to Problem Set after") : ""}
            </span>
          </div>
        </div>
        {waitingToStart && official && (
          <button className="primary" disabled={busy || c.problems.length === 0} onClick={() => setControlRun({ id: official.id, action: "start-now" })}>
            Start contest now ({length})
          </button>
        )}
      </div>

      <Lifecycle status={c.status} hasProblems={c.problems.length > 0} />

      {/* Actionable Status Banner */}
      {waitingToStart && official && (
        <div className={"notice " + (official.manual_start ? "ok" : "") + " row-between"} style={{ gap: "1rem", flexWrap: "wrap" }}>
          <div>
            {official.manual_start ? (
              <><strong>Registration is open.</strong> Participants can register and wait in the lobby — the contest stays paused until you click <strong>Start contest now</strong>.</>
            ) : (
              <>Scheduled for <strong>{when(official.starts_at)}</strong> (starts in {clock(new Date(official.starts_at).getTime() - serverNow())}). You can still start it early or edit problems below.</>
            )}
          </div>
          <div className="row" style={{ gap: "0.5rem" }}>
            <button type="button" className="small" onClick={copyLobbyLink}>Copy lobby link</button>
            <button type="button" className="primary small" disabled={busy || c.problems.length === 0} onClick={() => setControlRun({ id: official.id, action: "start-now" })}>
              Start contest now
            </button>
          </div>
        </div>
      )}

      {readiness.data && !readiness.data.ready && !started && (
        <div className="notice warn">
          <strong>Fix before launching</strong>
          <ul className="small" style={{ margin: "0.35rem 0 0" }}>{readiness.data.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {/* Primary Section Navigation */}
      <div className="tabs" role="tablist">
        {activeRun && (
          <button role="tab" aria-selected={activeTab === "monitor"} className={activeTab === "monitor" ? "active" : ""} onClick={() => setSection("monitor")}>
            {started ? "● Live monitor" : "Run monitor"}
          </button>
        )}
        <button role="tab" aria-selected={activeTab === "problems"} className={activeTab === "problems" ? "active" : ""} onClick={() => setSection("problems")}>
          Problems ({c.problems.length})
        </button>
        <button role="tab" aria-selected={activeTab === "participants"} className={activeTab === "participants" ? "active" : ""} onClick={() => setSection("participants")}>
          Participants ({participantsData.data?.length ?? "…"})
        </button>
        <button role="tab" aria-selected={activeTab === "launch"} className={activeTab === "launch" ? "active" : ""} onClick={() => setSection("launch")}>
          {official ? "Launch & settings" : "Launch & publish"}
        </button>
      </div>

      {/* TAB 1: LIVE MONITOR */}
      {activeTab === "monitor" && activeRun && (
        <div className="stack" style={{ gap: "1rem" }}>
          {c.runs.length > 1 && (
            <div className="row" style={{ gap: "0.4rem" }}>
              <span className="small muted">Viewing run:</span>
              {c.runs.map((r) => (
                <button key={r.id} className={"small" + (activeRun.id === r.id ? " primary" : "")} onClick={() => setSelectedRun(r.id)}>
                  {r.kind === "OFFICIAL" ? "Official" : "Rehearsal"} · {r.status}
                </button>
              ))}
            </div>
          )}
          <RunMonitor key={activeRun.id} run={activeRun} problems={c.problems} onChanged={refresh} holdsResults={c.visibility === "PUBLIC" && c.version.freeze_before_end_seconds > 0} />
        </div>
      )}

      {/* TAB 2: PROBLEMS (FULL WIDTH, SPACIOUS) */}
      {activeTab === "problems" && (
        <section className="card stack" style={{ gap: "1rem" }}>
          <div className="row-between">
            <div>
              <h3 style={{ margin: 0 }}>Contest problems ({c.problems.length})</h3>
              <p className="small muted" style={{ margin: "0.2rem 0 0" }}>
                {canEditProblems
                  ? (sealed ? "Contest hasn't started yet — you can still add, remove, or adjust release days before clicking Start." : "Add approved problems and set their order or Warmup release days.")
                  : "Problems are locked while the contest is live or finished."}
              </p>
            </div>
            {canEditProblems && showReleaseDay && sortedProblems.length > 1 && (
              <button type="button" className="small" disabled={busy} onClick={() => run(async () => {
                for (let idx = 0; idx < sortedProblems.length; idx++) {
                  const targetDay = Math.min(maxDays, Math.floor((idx * maxDays) / sortedProblems.length) + 1);
                  if ((sortedProblems[idx].release_day ?? 1) !== targetDay) {
                    await patch("/api/manage/competitions/" + id + "/problems/" + sortedProblems[idx].slot, { releaseDay: targetDay });
                  }
                }
                refresh();
              }, `Spread problems across ${maxDays} days`)}>
                Spread across {maxDays} days
              </button>
            )}
          </div>

          {sortedProblems.length === 0 ? (
            <Empty>No problems attached yet. Pick an approved problem below to add it.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>#</th>
                    <th>Problem</th>
                    <th style={{ width: 110 }}>Difficulty</th>
                    {(showReleaseDay || hasStaggeredDays) && <th style={{ width: 140 }}>Release day</th>}
                    {canEditProblems && <th className="right" style={{ width: 110 }} />}
                  </tr>
                </thead>
                <tbody>
                  {sortedProblems.map((p) => {
                    const info = byVersion[p.problem_version_id];
                    return (
                      <tr key={p.slot}>
                        <td><span className="problem-letter">{p.label}</span></td>
                        <td>
                          <strong>{info?.title ?? <span className="mono small">{p.problem_version_id}</span>}</strong>
                          {info?.slug && <div className="small muted mono">{info.slug}</div>}
                        </td>
                        <td>{info?.difficulty ? <DifficultyPill value={info.difficulty} /> : <span className="small muted">—</span>}</td>
                        {(showReleaseDay || hasStaggeredDays) && (
                          <td>
                            {canEditProblems && showReleaseDay ? (
                              <select aria-label={`Release day for ${p.label}`} style={{ width: "auto" }} disabled={busy}
                                value={Math.min(maxDays, p.release_day ?? 1)}
                                onChange={(e) => {
                                  const releaseDay = Number(e.target.value);
                                  run(async () => { await patch("/api/manage/competitions/" + id + "/problems/" + p.slot, { releaseDay }); refresh(); }, `Moved ${p.label} to Day ${releaseDay}`);
                                }}>
                                {Array.from({ length: maxDays }, (_, k) => k + 1).map((dayNum) => <option key={dayNum} value={dayNum}>Day {dayNum}</option>)}
                              </select>
                            ) : <span className="tag">Day {p.release_day ?? 1}</span>}
                          </td>
                        )}
                        {canEditProblems && (
                          <td className="right">
                            <button type="button" className="small danger ghost" disabled={busy}
                              onClick={() => run(async () => { await del("/api/manage/competitions/" + id + "/problems/" + p.slot); refresh(); }, `Removed ${p.label}`)}>
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canEditProblems && (
            <form className="card-flat row" style={{ alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }} onSubmit={(e) => {
              e.preventDefault();
              const slot = (c.problems.reduce((m, p) => Math.max(m, p.slot), 0)) + 1;
              run(async () => {
                await post("/api/manage/competitions/" + id + "/problems", {
                  versionId: attach.versionId,
                  slot,
                  label: attach.label || (slot <= 26 ? String.fromCharCode(64 + slot) : "P" + slot),
                  releaseDay: showReleaseDay ? Math.min(maxDays, Math.max(1, attach.releaseDay)) : 1,
                });
                setAttach({ versionId: "", label: "", releaseDay: attach.releaseDay });
                refresh();
              }, "Problem attached");
            }}>
              <div style={{ flex: "1 1 320px", minWidth: 220 }}>
                <Field label="Add approved problem">
                  <SearchSelect
                    value={attach.versionId}
                    onChange={(v) => setAttach({ ...attach, versionId: v })}
                    placeholder="Choose a problem…"
                    searchPlaceholder="Search by title, slug, or collection…"
                    options={approved.map((p) => ({
                      value: p.version_id,
                      label: p.title,
                      sub: `${p.slug}${p.folder ? ` · ${p.folder}` : ""}`,
                      meta: p.difficulty ?? "MEDIUM",
                      keywords: `${p.folder ?? ""} ${p.difficulty ?? ""}`,
                    }))}
                  />
                </Field>
              </div>
              <Field label="Label">
                <input maxLength={8} placeholder="auto" value={attach.label} onChange={(e) => setAttach({ ...attach, label: e.target.value })} style={{ width: 90 }} />
              </Field>
              {showReleaseDay && (
                <Field label="Release day">
                  <select value={Math.min(maxDays, attach.releaseDay)} onChange={(e) => setAttach({ ...attach, releaseDay: Number(e.target.value) })} style={{ width: 110 }}>
                    {Array.from({ length: maxDays }, (_, k) => k + 1).map((dayNum) => <option key={dayNum} value={dayNum}>Day {dayNum}</option>)}
                  </select>
                </Field>
              )}
              <button className="primary" disabled={busy || !attach.versionId}>+ Attach problem</button>
            </form>
          )}
        </section>
      )}

      {/* TAB 3: PARTICIPANTS */}
      {activeTab === "participants" && (
        <Participants id={id} mode={c.version.mode} status={c.status} list={participantsData} />
      )}

      {/* TAB 4: LAUNCH & SETTINGS */}
      {activeTab === "launch" && (
        <div className="stack" style={{ gap: "1.25rem" }}>
          <section className="card stack accent">
            <div className="row-between">
              <h3 style={{ margin: 0 }}>Launch &amp; visibility</h3>
              <label className="row small" title="Unrated contests still appear on profiles and pay Sigma, but do not change anyone's rating.">
                <input type="checkbox" checked={c.rated} disabled={busy} onChange={(e) => {
                  const rated = e.target.checked;
                  run(async () => { await post("/api/manage/competitions/" + id + "/rated", { rated, reason: "Changed from the contest page" }); refresh(); }, rated ? "This contest now counts for rating" : "This contest no longer counts for rating");
                }} />
                Counts for player rating
              </label>
            </div>

            {readiness.data?.ready && (
              <div className="notice ok small">Ready to go: problems are approved and validated, and judges are online for every language.</div>
            )}

            {!official ? (
              <form className="stack" onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  if (c.status === "DRAFT") {
                    let teamIds: string[] | undefined;
                    if (c.version.mode === "TEAM") teamIds = [(await post<{ teamId: string }>("/api/teams", { name: ("Jury " + c.slug).slice(0, 100) })).teamId];
                    const reh = await post<{ runId: string }>("/api/manage/competitions/" + id + "/rehearsals", teamIds ? { teamIds } : {});
                    await post("/api/manage/runs/" + reh.runId + "/control", { action: "end-rehearsal", reason: "Automatic pre-launch check" });
                  }
                  const startMs = fromZoneInput(startsAt);
                  const payload = launchMode === "now"
                    ? { startNow: true, visibility, reason: "Started from the contest page" }
                    : launchMode === "manual"
                      ? { manualStart: true, visibility }
                      : { startsAt: new Date(startMs).toISOString(), visibility };
                  await post("/api/manage/competitions/" + id + "/schedule", payload);
                  refresh();
                }, launchMode === "now" ? "The contest is live!" : launchMode === "manual" ? "Published! Registration is open — hit Start whenever you're ready." : "Contest scheduled and published");
              }}>
                <div className="launch">
                  <button type="button" className={"option" + (launchMode === "manual" ? " active" : "")} onClick={() => setLaunchMode("manual")}>
                    <strong>Publish &amp; open registration</strong><span className="small muted">Students see it and register now; you click Start whenever the room is ready ({length}).</span>
                  </button>
                  <button type="button" className={"option" + (launchMode === "now" ? " active" : "")} onClick={() => setLaunchMode("now")}>
                    <strong>Start now immediately</strong><span className="small muted">Opens live right away and ends after {length}.</span>
                  </button>
                  <button type="button" className={"option" + (launchMode === "scheduled" ? " active" : "")} onClick={() => setLaunchMode("scheduled")}>
                    <strong>Schedule date &amp; time</strong><span className="small muted">Auto-starts at a fixed date &amp; time with a countdown.</span>
                  </button>
                </div>
                <div className="grid grid-2">
                  {launchMode === "scheduled" && <Field label={`Start (${localTimeZone()})`}><input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></Field>}
                  <Field label="Who can see it"><select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                    <option value="PUBLIC">Public: listed for everyone</option><option value="UNLISTED">Unlisted: link only</option><option value="PRIVATE">Private: invited users only</option></select></Field>
                </div>
                <div>
                  <button className="primary" disabled={busy || !readiness.data?.ready || c.problems.length === 0 || (launchMode === "scheduled" && !(fromZoneInput(startsAt) > serverNow()))}>
                    {launchMode === "now" ? "Start the contest now" : launchMode === "manual" ? "Publish & open registration" : "Publish & schedule"}
                  </button>
                </div>
              </form>
            ) : official.status === "PENDING" ? (
              <div className="row" style={{ gap: "0.75rem" }}>
                <button className="primary" disabled={busy || c.problems.length === 0} onClick={() => setControlRun({ id: official.id, action: "start-now" })}>
                  Start contest now ({length})
                </button>
                <button type="button" onClick={copyLobbyLink}>Copy lobby link</button>
              </div>
            ) : (
              <div className="notice small">The official contest {official.status === "RUNNING" ? "is currently live" : "has finished"}.</div>
            )}

            <details>
              <summary className="small"><strong>Rehearsals</strong> — try the contest privately as a contestant</summary>
              <div className="stack" style={{ marginTop: "0.6rem" }}>
                <div>
                  <button className="small" disabled={busy || c.problems.length === 0 || ["SCHEDULED", "RUNNING", "FINISHED"].includes(c.status)}
                    onClick={() => run(async () => { const r = await post<{ runId: string }>("/api/manage/competitions/" + id + "/rehearsals", {}); setSelectedRun(r.runId); setSection("monitor"); refresh(); }, "Rehearsal started (you are the entrant)")}>
                    Start a rehearsal
                  </button>
                </div>
                {c.runs.length > 0 && (
                  <div className="stack" style={{ gap: "0.4rem" }}>
                    {c.runs.map((r) => (
                      <button key={r.id} className={"small" + (activeRun?.id === r.id ? " primary" : "")} style={{ justifyContent: "space-between" }} onClick={() => { setSelectedRun(r.id); setSection("monitor"); }}>
                        <span>{r.kind === "OFFICIAL" ? "Official" : "Rehearsal"} · {r.manual_start && r.status === "PENDING" ? "Registration open" : when(r.starts_at)}</span>
                        <span className="small">{r.status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </section>

          {!sealed ? (
            <section className="card stack">
              <SettingsForm d={c} onSaved={refresh} />
            </section>
          ) : (
            <section className="card stack">
              <h3 style={{ margin: 0 }}>Configuration summary</h3>
              <div className="grid grid-3 small">
                <div><span className="muted">Duration</span><div><strong>{length}</strong></div></div>
                <div><span className="muted">Scoring</span><div><strong>{c.version.scoring_system ?? "ICPC"}</strong></div></div>
                <div><span className="muted">Full screen</span><div><strong>{c.version.require_fullscreen ? "Required" : "Optional"}</strong></div></div>
              </div>
              <span className="small muted">Settings are locked once published. Need to change duration, mode, or scoring? Delete this contest and create a fresh one, or edit problems in the Problems tab before starting.</span>
            </section>
          )}
        </div>
      )}

      {controlRun && (
        <ReasonDialog
          title="Start the contest now"
          confirm="Start now"
          description="The contest opens immediately and ends after its configured duration. Registered entrants see the problems at once."
          onClose={() => setControlRun(null)}
          onSubmit={(reason) => run(async () => {
            await post("/api/manage/runs/" + controlRun.id + "/control", { action: controlRun.action, reason });
            setControlRun(null);
            setSection("monitor");
            refresh();
          }, "The contest is live!")}
        />
      )}

      {confirmDelete && (
        <ReasonDialog
          title={`Delete contest: ${c.title}`}
          confirm="Delete permanently"
          danger
          description={<>This permanently deletes <strong>{c.title}</strong> ({c.slug}) along with all runs, registrations, and submissions so you can start fresh. Problems in your Problem Library are kept.</>}
          onClose={() => setConfirmDelete(false)}
          onSubmit={(reason) => run(async () => {
            await del("/api/manage/competitions/" + id + (reason ? "?reason=" + encodeURIComponent(reason) : ""));
            setConfirmDelete(false);
            navigate("/admin/contests");
          }, "Contest deleted")}
        />
      )}
    </div>
  );
}

function SettingsForm({ d, onSaved }: { d: Detail; onSaved: () => void }) {
  const initTotalMin = Math.max(1, Math.round(d.version.duration_seconds / 60));
  const [f, setF] = useState({
    title: d.title,
    format: (d.version.contest_format ?? "STANDARD") as ContestFormat,
    scoring: (d.version.scoring_system ?? "ICPC") as "ICPC" | "IOI" | "CODEFORCES" | "ATCODER",
    description: d.version.description_md,
    rules: d.version.rules_md,
    days: Math.floor(initTotalMin / 1440),
    hours: Math.floor((initTotalMin % 1440) / 60),
    minutes: initTotalMin % 60,
    publishToPractice: Boolean(d.version.publish_to_practice),
    requireFullscreen: Boolean(d.version.require_fullscreen ?? (d.version.contest_format !== "WARMUP")),
    freezeMinutes: Math.round(d.version.freeze_before_end_seconds / 60),
    penaltyMinutes: Math.round(d.version.wrong_attempt_penalty_seconds / 60),
  });
  const { busy, run } = useAction();
  const durationSeconds = Math.max(60, f.days * 86400 + f.hours * 3600 + f.minutes * 60);
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      run(async () => {
        await patch("/api/manage/competitions/" + d.id, {
          title: f.title,
          format: f.format,
          scoringSystem: f.scoring,
          description: f.description,
          rules: f.rules,
          durationSeconds,
          freezeBeforeEndSeconds: Math.min(f.freezeMinutes * 60, durationSeconds - 1),
          wrongAttemptPenaltySeconds: f.penaltyMinutes * 60,
          publishToPractice: f.publishToPractice,
          requireFullscreen: f.requireFullscreen,
        });
        onSaved();
      }, "Contest settings saved");
    }}>
      <h3 style={{ margin: 0 }}>Contest settings</h3>
      <div className="grid grid-2">
        <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Category (for filtering)">
          <select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as ContestFormat })}>
            <option value="BASIC">Basic</option>
            <option value="WARMUP">Warmup</option>
            <option value="STANDARD">Normal</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-3">
        <Field label="Duration (d / h / m)">
          <div className="row" style={{ flexWrap: "nowrap", gap: "0.3rem" }}>
            <input type="number" min={0} max={60} value={f.days} onChange={(e) => setF({ ...f, days: Math.max(0, Number(e.target.value)) })} aria-label="Days" />
            <span className="small muted">d</span>
            <input type="number" min={0} max={23} value={f.hours} onChange={(e) => setF({ ...f, hours: Math.max(0, Number(e.target.value)) })} aria-label="Hours" />
            <span className="small muted">h</span>
            <input type="number" min={0} max={59} value={f.minutes} onChange={(e) => setF({ ...f, minutes: Math.max(0, Number(e.target.value)) })} aria-label="Minutes" />
            <span className="small muted">m</span>
          </div>
        </Field>
        <Field label="Scoring system">
          <select value={f.scoring} onChange={(e) => setF({ ...f, scoring: e.target.value as typeof f.scoring })}>
            <option value="ICPC">ICPC</option>
            <option value="IOI">IOI</option>
            <option value="CODEFORCES">Codeforces</option>
            <option value="ATCODER">AtCoder</option>
          </select>
        </Field>
        <Field label="Freeze before end (min)"><input type="number" min={0} value={f.freezeMinutes} onChange={(e) => setF({ ...f, freezeMinutes: Number(e.target.value) })} /></Field>
      </div>
      {f.scoring === "ICPC" && (
        <Field label="Penalty per rejection (min)"><input type="number" min={0} value={f.penaltyMinutes} onChange={(e) => setF({ ...f, penaltyMinutes: Number(e.target.value) })} style={{ maxWidth: 180 }} /></Field>
      )}
      <div className="row" style={{ gap: "1rem" }}>
        <label className="check small"><input type="checkbox" checked={f.requireFullscreen} onChange={(e) => setF({ ...f, requireFullscreen: e.target.checked })} />Require full screen in the arena</label>
        <label className="check small"><input type="checkbox" checked={f.publishToPractice} onChange={(e) => setF({ ...f, publishToPractice: e.target.checked })} />Publish problems to Problem Set when contest ends</label>
      </div>
      <Field label="Description (Markdown)"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Rules (Markdown)"><textarea rows={3} value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} /></Field>
      <div><button className="primary" disabled={busy}>Save settings</button></div>
    </form>
  );
}

type JurySubmission = { id: string; entry_name: string; handle: string; problem_slot: number; language_code: string; submitted_at: string; status: string; verdict: string | null; execution_time_ms: number | null; passed_tests: number | null; total_tests: number | null; generation: number };
type Clarification = { id: string; question: string; answer: string | null; is_public: boolean; created_at: string };

function RunMonitor({ run: r, problems, onChanged, holdsResults }: { run: Run; problems: { slot: number; label: string }[]; onChanged: () => void; holdsResults: boolean }) {
  const route = useRoute();
  const [tab, setTab] = useState<"submissions" | "standings" | "clarifications" | "announce" | "fullscreen">(route.query.get("tab") === "fullscreen" ? "fullscreen" : "submissions");
  useEffect(() => { if (route.query.get("tab") === "fullscreen") setTab("fullscreen"); }, [route.query.get("tab")]); // eslint-disable-line react-hooks/exhaustive-deps
  const fullscreenLog = useData<FullscreenData>("/api/manage/runs/" + r.id + "/fullscreen", 5000);
  const awayNow = (fullscreenLog.data?.people ?? []).filter((p) => p.away_now).length;
  const fullscreenCount = fullscreenLog.data?.total ?? 0;
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
          <span className="eyebrow">{r.kind === "OFFICIAL" ? "Official contest" : "Rehearsal"} · {phase.phase === "live" ? "live" : phase.phase === "upcoming" ? (r.manual_start ? "registration open" : "starts in") : "finished"}</span>
          <span className="row">{phase.phase === "live" && <LiveDot />}<span className="clock">{phase.phase === "ended" ? "Ended" : r.manual_start && phase.phase === "upcoming" ? "Waiting for Start" : clock(phase.ms)}</span></span>
        </div>
        {r.submissions_paused && <Badge tone="warn">Submissions paused</Badge>}
        {r.final_standings_released_at && <Badge tone="ok">Final standings released</Badge>}
        <span className="spacer" />
        {phase.phase === "upcoming" && r.kind === "OFFICIAL" && <button className="primary" onClick={() => setControl("start-now")}>Start now</button>}
        {phase.phase !== "ended" && (r.submissions_paused ? <button onClick={() => setControl("resume")}>Resume submissions</button> : phase.phase === "live" && <button className="danger" onClick={() => setControl("pause")}>Pause submissions</button>)}
        {phase.phase !== "ended" && <button onClick={() => setControl("extend")}>+10 min</button>}
        {phase.phase === "live" && r.kind === "OFFICIAL" && <button className="danger" onClick={() => setControl("end-now")}>End now</button>}
        {r.kind === "REHEARSAL" && r.status !== "FINISHED" && <button onClick={() => setControl("end-rehearsal")}>End rehearsal</button>}
        {phase.phase === "ended" && !r.final_standings_released_at && <button className="primary" onClick={() => setControl("release-standings")}>Release final standings</button>}
        <a className="btn" href={"#/arena/" + r.id}>Open arena</a>
      </div>
      <div className="stack" style={{ padding: "0 1.25rem 1.25rem" }}>
        {holdsResults && r.kind === "OFFICIAL" && phase.phase === "ended" && !r.final_standings_released_at && (
          <div className="notice warn row-between">
            <span><strong>These results are not counting yet.</strong> Contestants still see the frozen scoreboard, and this contest adds nothing to Sigma, ratings, medals or profiles until you release it.</span>
            <button className="primary small" onClick={() => setControl("release-standings")}>Release final standings</button>
          </div>
        )}
        <div className="row small">{Object.entries(counts).map(([k, v]) => <Badge key={k} tone={k === "ACCEPTED" ? "ok" : k === "WAITING" || k === "RUNNING" ? "info" : "neutral"}>{k.replace(/_/g, " ")}: {v}</Badge>)}</div>
        <div className="tabs">
          <button className={tab === "submissions" ? "active" : ""} onClick={() => setTab("submissions")}>Submissions</button>
          <button className={tab === "standings" ? "active" : ""} onClick={() => setTab("standings")}>Jury standings</button>
          <button className={tab === "clarifications" ? "active" : ""} onClick={() => setTab("clarifications")}>Clarifications{open_ ? ` (${open_} open)` : ""}</button>
          <button className={tab === "announce" ? "active" : ""} onClick={() => setTab("announce")}>Announce</button>
          <button className={(tab === "fullscreen" ? "active " : "") + (awayNow ? "fullscreen-tab-alert" : "")} onClick={() => setTab("fullscreen")}>Full screen log{fullscreenCount ? ` (${fullscreenCount})` : ""}{awayNow ? ` · ${awayNow} away` : ""}</button>
        </div>
        {tab === "fullscreen" && <><ErrorBox error={fullscreenLog.error} /><FullscreenPanel runId={r.id} ended={phase.phase === "ended"} data={fullscreenLog.data} /></>}
        {tab === "submissions" && (
          <>
            <input placeholder="Filter by entrant, handle or problem" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 360 }} />
            {subs.loading ? <Loading /> : rows.length === 0 ? <Empty>No submissions.</Empty> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Time</th><th>Entrant</th><th>Problem</th><th>Lang</th><th>Verdict</th><th className="right">Tests</th><th className="right">Time</th><th /></tr></thead>
                <tbody>{rows.map((s) => (
                  <tr key={s.id}>
                    <td className="small">{timeOf(s.submitted_at)}</td>
                    <td>{s.entry_name}<div className="small muted"><UserLink handle={s.handle} /></div></td>
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
        {tab === "standings" && <Standings runId={r.id} labels={labels} jury links />}
        {tab === "clarifications" && (
          <div className="stack">
            {(clar.data ?? []).length === 0 ? <Empty>No questions.</Empty> : (clar.data ?? []).map((c) => (
              <div key={c.id} className="card-flat stack">
                <div className="row-between small muted"><span>{timeOf(c.created_at)}</span>{c.answer ? <Badge tone="ok">{c.is_public ? "Answered publicly" : "Answered"}</Badge> : <Badge tone="warn">Open</Badge>}</div>
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

type ParticipantRow = { id: string; handle: string | null; display_name: string | null; email: string | null; team: string | null; status: string; created_at?: string };

function Participants({ id, mode, status, list }: { id: string; mode: string; status: string; list: { data?: ParticipantRow[]; loading: boolean; reload: () => void } }) {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const { busy, run } = useAction();
  const toast = useToast();
  const closed = ["RUNNING", "FINISHED", "ARCHIVED"].includes(status);
  const rows = (list.data ?? []).filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [p.team, p.display_name, p.handle, p.email].filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  return (
    <section className="card stack" style={{ gap: "1rem" }}>
      <div className="row-between">
        <div>
          <h3 style={{ margin: 0 }}>Registered participants ({list.data?.length ?? "…"})</h3>
          <p className="small muted" style={{ margin: "0.2rem 0 0" }}>
            {mode === "TEAM" ? "Team captains register their teams from the contest lobby." : "Participants can self-register from the lobby, or you can add them in bulk below."}
          </p>
        </div>
        {(list.data?.length ?? 0) > 0 && (
          <input placeholder="Filter participants…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260 }} />
        )}
      </div>

      {mode === "INDIVIDUAL" && !closed && (
        <div className="card-flat row" style={{ alignItems: "flex-end", gap: "0.75rem" }}>
          <div style={{ flex: 1 }}>
            <Field label="Bulk register by handle or email" hint="One per line or comma-separated. Create accounts first in Users → Import users.">
              <textarea rows={2} className="mono" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </div>
          <button className="primary" disabled={busy || !text.trim()} onClick={() => run(async () => {
            const result = await post<{ user: string; status: string }[]>("/api/manage/competitions/" + id + "/participants", { users: text.split(/[\s,;]+/).filter(Boolean) });
            const failed = result.filter((r) => r.status !== "REGISTERED");
            toast(failed.length ? "info" : "success", (result.length - failed.length) + " registered" + (failed.length ? "; " + failed.map((f) => f.user + " " + f.status.toLowerCase().replace(/_/g, " ")).join(", ") : ""));
            setText(""); list.reload();
          })}>Register</button>
        </div>
      )}

      {list.loading ? <Loading /> : rows.length === 0 ? (
        <Empty>{(list.data?.length ?? 0) === 0 ? "No registrations yet." : "No participant matches that search."}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Participant</th><th>Email</th><th>Status</th><th>Registered</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.team ?? p.display_name}</strong>
                    {p.handle && <div className="small muted"><UserLink handle={p.handle} /></div>}
                  </td>
                  <td className="small">{p.email ?? "—"}</td>
                  <td><Badge tone="ok">{p.status}</Badge></td>
                  <td className="small muted">{p.created_at ? when(p.created_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
