import { useEffect, useMemo, useState } from "react";
import { get, post, serverNow } from "../../api";
import { navigate, useData } from "../../app";
import { ProgressLog, slugify, type LogLine } from "../../components/Wizard";
import { LanguagePicker } from "../../components/LanguagePicker";
import { SCORING_INFO } from "../../components/Standings";
import { DifficultyPill } from "../Practice";
import { AdminIcon } from "../../components/AdminIcons";
import { SearchSelect } from "../../components/SearchSelect";
import { Badge, CONTEST_FORMAT_LABEL, Empty, Field, Loading, consumeQueuedContestProblems, formatDuration, fromZoneInput, localTimeZone, toZoneInput, when } from "../../ui";

type ContestFormat = "STANDARD" | "BASIC" | "WARMUP";
type Lab = {
  id?: string;
  version_id: string;
  title: string;
  slug: string;
  status: string;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  tags?: string[];
  folder?: string | null;
  in_problem_set?: boolean;
  td_number?: number | null;
  mission_slug?: string | null;
};
type Draft = {
  title: string; slug: string; kind: ContestFormat;
  mode: "INDIVIDUAL" | "TEAM"; maxTeamSize: number;
  durationSeconds: number;
  launchMode: "manual" | "scheduled";
  freezeMinutes: number; penaltyMinutes: number; penalizeCompilationErrors: boolean;
  languages: string[]; description: string; rules: string;
  problems: string[]; participants: string; startsAt: string; visibility: string;
  scoring: "ICPC" | "IOI" | "CODEFORCES" | "ATCODER"; points: Record<string, number>; releaseDays: Record<string, number>;
  publishToPractice: boolean; requireFullscreen: boolean; rated: boolean;
  touchedTiming?: boolean; touchedScoring?: boolean;
};

const KEY = "cp.contest-wizard.v2";
const RULES_BY_SCORING: Record<Draft["scoring"], string> = {
  ICPC: "- Most problems solved wins; ties are broken by total time + penalty.\n- Each rejected attempt before acceptance adds the configured penalty.\n- Ask questions about statements through Clarifications.\n- Do not share code while the contest is running.",
  IOI: "- Each problem counts your best submission (partial points for passed tests).\n- No time penalty for rejected attempts — solve at your own pace.\n- Ask questions about statements through Clarifications.\n- Do not share code until the contest ends.",
  CODEFORCES: "- Problem points decrease gradually over time; rejected attempts deduct points.\n- Ask questions about statements through Clarifications.\n- Do not share code while the contest is running.",
  ATCODER: "- Fixed points per problem; ties broken by time of last scoring submission + penalty.\n- Ask questions about statements through Clarifications.\n- Do not share code while the contest is running.",
};

function nextHour() {
  return toZoneInput(serverNow() + 60 * 60 * 1000).slice(0, 14) + "00";
}
const startIso = (value: string) => new Date(fromZoneInput(value)).toISOString();

const PRESETS: Record<ContestFormat, Pick<Draft, "durationSeconds" | "scoring" | "freezeMinutes" | "penaltyMinutes" | "requireFullscreen" | "rated" | "publishToPractice">> = {
  BASIC: { durationSeconds: 90 * 60, scoring: "ICPC", freezeMinutes: 0, penaltyMinutes: 10, requireFullscreen: true, rated: false, publishToPractice: false },
  WARMUP: { durationSeconds: 7 * 86400, scoring: "IOI", freezeMinutes: 0, penaltyMinutes: 0, requireFullscreen: false, rated: false, publishToPractice: true },
  STANDARD: { durationSeconds: 3 * 3600, scoring: "ICPC", freezeMinutes: 60, penaltyMinutes: 20, requireFullscreen: true, rated: true, publishToPractice: false },
};

const DURATION_CHIPS: [string, number][] = [
  ["45m", 45 * 60],
  ["1h", 3600],
  ["1h 30m", 90 * 60],
  ["2h", 2 * 3600],
  ["3h", 3 * 3600],
  ["5h", 5 * 3600],
  ["1 day", 86400],
  ["3 days", 3 * 86400],
  ["7 days", 7 * 86400],
  ["14 days", 14 * 86400],
];

const EMPTY: Draft = {
  title: "", slug: "", kind: "BASIC", mode: "INDIVIDUAL", maxTeamSize: 3,
  ...PRESETS.BASIC,
  launchMode: "manual",
  penalizeCompilationErrors: false, languages: ["CPP", "C", "JAVA", "PYTHON"],
  description: "", rules: RULES_BY_SCORING.ICPC,
  problems: [], participants: "", startsAt: nextHour(), visibility: "PUBLIC", points: {}, releaseDays: {},
  touchedTiming: false, touchedScoring: false,
};

const DIFF_WEIGHT: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3 };
const defaultPoints = (scoring: Draft["scoring"], i: number, difficulty?: string) => {
  const mult = DIFF_WEIGHT[difficulty ?? "MEDIUM"] ?? 2;
  if (scoring === "IOI") return 100 * mult;
  if (scoring === "CODEFORCES") return 500 * (i + 1);
  if (scoring === "ATCODER") return 100 * (i + 1);
  return 1;
};
const label = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : "P" + (i + 1));
const inferredDay = (folder?: string | null) => {
  const m = folder ? /\bday\s*(\d+)\b/i.exec(folder) : null;
  return m ? Number(m[1]) : 1;
};
const hasExplicitDay = (folder?: string | null) => Boolean(folder && /\bday\s*\d+\b/i.test(folder));

function splitDuration(totalSeconds: number) {
  const mins = Math.max(1, Math.round(totalSeconds / 60));
  const days = Math.floor(mins / 1440);
  const rem = mins % 1440;
  return { days, hours: Math.floor(rem / 60), minutes: rem % 60 };
}

export default function ContestWizard() {
  const lab = useData<Lab[]>("/api/lab/problems");
  const [d, setD] = useState<Draft>(() => {
    const handoff = consumeQueuedContestProblems();
    if (handoff && handoff.versionIds.length > 0) {
      const kind = handoff.kind ?? "STANDARD";
      const p = PRESETS[kind];
      return {
        ...EMPTY,
        ...p,
        kind,
        rules: RULES_BY_SCORING[p.scoring],
        problems: handoff.versionIds,
        startsAt: nextHour(),
      };
    }
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      return { ...EMPTY, startsAt: nextHour(), ...saved };
    } catch {
      return { ...EMPTY, startsAt: nextHour() };
    }
  });
  const [problemSearch, setProblemSearch] = useState("");
  const [diffFilter, setDiffFilter] = useState<"" | "EASY" | "MEDIUM" | "HARD">(() => (d.kind === "BASIC" && d.problems.length === 0 ? "EASY" : ""));
  const [privateOnly, setPrivateOnly] = useState(false);
  const [folderFilter, setFolderFilter] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ }
  }, [d]);

  const set = (change: Partial<Draft>) => setD((old) => ({ ...old, ...change }));

  const applyPreset = (kind: ContestFormat, force = false) => {
    const p = PRESETS[kind];
    setD((old) => {
      const nextScoring = force || !old.touchedScoring ? p.scoring : old.scoring;
      const nextDuration = force || !old.touchedTiming ? p.durationSeconds : old.durationSeconds;
      const nextFreeze = Math.min(force || !old.touchedTiming ? p.freezeMinutes : old.freezeMinutes, Math.max(0, Math.floor(nextDuration / 60) - 1));
      const defaultRuleValues = Object.values(RULES_BY_SCORING);
      const nextRules = defaultRuleValues.includes(old.rules) ? RULES_BY_SCORING[nextScoring] : old.rules;
      return {
        ...old,
        kind,
        durationSeconds: nextDuration,
        scoring: nextScoring,
        freezeMinutes: nextFreeze,
        penaltyMinutes: force || !old.touchedScoring ? p.penaltyMinutes : old.penaltyMinutes,
        requireFullscreen: force || !old.touchedTiming ? p.requireFullscreen : old.requireFullscreen,
        rated: force || !old.touchedScoring ? p.rated : old.rated,
        publishToPractice: force || !old.touchedScoring ? p.publishToPractice : old.publishToPractice,
        rules: nextRules,
        ...(force ? { touchedTiming: false, touchedScoring: false } : {}),
      };
    });
    if (kind === "BASIC") setDiffFilter("EASY");
    else if (diffFilter === "EASY" && d.problems.length === 0) setDiffFilter("");
  };

  const setDuration = (seconds: number) => {
    const clamped = Math.max(60, Math.min(60 * 86400, Math.round(seconds)));
    const maxFreezeMin = Math.max(0, Math.floor(clamped / 60) - 1);
    set({
      durationSeconds: clamped,
      freezeMinutes: Math.min(d.freezeMinutes, maxFreezeMin),
      // Multi-day contests should not trap participants in full screen unless explicitly re-enabled.
      ...(clamped > 86400 && d.durationSeconds <= 86400 ? { requireFullscreen: false } : {}),
      touchedTiming: true,
    });
  };

  const approved = useMemo(() => {
    const seen = new Set<string>();
    const out: Lab[] = [];
    for (const p of lab.data ?? []) {
      if (p.status !== "APPROVED" && p.status !== "PUBLISHED") continue;
      const key = p.id ?? p.slug;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out;
  }, [lab.data]);
  const byId = useMemo(() => Object.fromEntries((lab.data ?? []).map((p) => [p.version_id, p])), [lab.data]);

  const allFolders = useMemo(() => {
    const set = new Set<string>();
    for (const p of approved) {
      if (!p.folder) continue;
      const segs = p.folder.split("/").filter(Boolean);
      for (let i = 1; i <= segs.length; i++) set.add(segs.slice(0, i).join("/"));
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [approved]);

  const isPublic = (p: Lab) => Boolean(p.in_problem_set || p.td_number != null || p.mission_slug);

  const filteredProblems = useMemo(() => {
    const q = problemSearch.trim().toLowerCase();
    const list = approved.filter((p) => {
      if (diffFilter && (p.difficulty ?? "MEDIUM") !== diffFilter) return false;
      if (privateOnly && isPublic(p)) return false;
      if (folderFilter === "__NONE__" && p.folder) return false;
      if (folderFilter && folderFilter !== "__NONE__" && !(p.folder === folderFilter || p.folder?.startsWith(folderFilter + "/"))) return false;
      if (!q) return true;
      return (p.title + " " + p.slug + " " + (p.tags ?? []).join(" ") + " " + (p.folder ?? "")).toLowerCase().includes(q);
    });
    return [...list].sort((a, b) => {
      const aHas = hasExplicitDay(a.folder) ? 0 : 1;
      const bHas = hasExplicitDay(b.folder) ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      if (aHas === 0) {
        const dayDiff = inferredDay(a.folder) - inferredDay(b.folder);
        if (dayDiff !== 0) return dayDiff;
      }
      const folderDiff = (a.folder ?? "").localeCompare(b.folder ?? "");
      if (folderDiff !== 0) return folderDiff;
      const dDiff = (DIFF_WEIGHT[a.difficulty ?? "MEDIUM"] ?? 2) - (DIFF_WEIGHT[b.difficulty ?? "MEDIUM"] ?? 2);
      if (dDiff !== 0) return dDiff;
      return a.title.localeCompare(b.title);
    });
  }, [approved, diffFilter, privateOnly, folderFilter, problemSearch]);

  const publicSelectedCount = useMemo(
    () => d.problems.filter((id) => byId[id] && isPublic(byId[id])).length,
    [d.problems, byId],
  );

  const startMs = fromZoneInput(d.startsAt);
  const endMs = Number.isNaN(startMs) ? NaN : startMs + d.durationSeconds * 1000;
  const endsAtInput = Number.isNaN(endMs) ? "" : toZoneInput(endMs);
  const { days, hours, minutes } = splitDuration(d.durationSeconds);
  const maxDays = Math.max(1, Math.ceil(d.durationSeconds / 86400));
  const showReleaseDay = d.kind === "WARMUP" && maxDays > 1;

  const handles = d.participants.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const issues: string[] = [];
  if (!d.title.trim()) issues.push("Enter a contest name");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)) issues.push("Short URL name must use lowercase letters, digits and dashes");
  if (d.durationSeconds < 60) issues.push("Duration must be at least 1 minute");
  if (d.freezeMinutes * 60 >= d.durationSeconds) issues.push("Scoreboard freeze must be shorter than the contest duration");
  if (d.problems.length === 0) issues.push("Select at least one problem");
  if (d.languages.length === 0) issues.push("Select at least one allowed language");

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

  async function finish(launch: "draft" | "manual" | "startNow" | "scheduled") {
    setBusy(true);
    setLog([]);
    try {
      let id = created;
      let existingProblemIds = new Set<string>();
      let existingVersionIds = new Set<string>();
      let usedSlots = new Set<number>();
      if (!id) {
        const r = await runStep("Creating contest", () => post<{ competitionId: string }>("/api/manage/competitions", {
          slug: d.slug,
          title: d.title.trim(),
          format: d.kind,
          mode: d.mode,
          maxTeamSize: d.mode === "TEAM" ? d.maxTeamSize : 1,
          languages: d.languages,
          durationSeconds: d.durationSeconds,
          scoringSystem: d.scoring,
          freezeBeforeEndSeconds: d.freezeMinutes * 60,
          wrongAttemptPenaltySeconds: d.penaltyMinutes * 60,
          penalizeCompilationErrors: d.penalizeCompilationErrors,
          publishToPractice: d.publishToPractice,
          requireFullscreen: d.requireFullscreen,
          rated: d.rated,
          ...(d.description.trim() ? { description: d.description } : {}),
          ...(d.rules.trim() ? { rules: d.rules } : {}),
        }));
        id = (r as { competitionId: string }).competitionId;
        setCreated(id);
      } else {
        const existing = await get<{ problems?: { slot: number; problem_id: string; problem_version_id: string }[] }>("/api/manage/competitions/" + id);
        for (const ep of existing.problems ?? []) {
          existingProblemIds.add(ep.problem_id);
          existingVersionIds.add(ep.problem_version_id);
          usedSlots.add(ep.slot);
        }
      }
      const seenInBatch = new Set<string>();
      const uniqueVersions = d.problems.filter((v) => {
        const key = byId[v]?.id ?? v;
        if (seenInBatch.has(key)) return false;
        seenInBatch.add(key);
        return true;
      });
      let nextSlot = 1;
      for (const [i, version] of uniqueVersions.entries()) {
        const pid = byId[version]?.id;
        if (existingVersionIds.has(version) || (pid && existingProblemIds.has(pid))) {
          nextSlot = Math.max(nextSlot, i + 2);
          continue;
        }
        while (usedSlots.has(nextSlot)) nextSlot++;
        const slot = nextSlot++;
        usedSlots.add(slot);
        const title = byId[version]?.title ?? version;
        await runStep(`Adding problem ${label(slot - 1)}: ${title}`, () => post("/api/manage/competitions/" + id + "/problems", {
          versionId: version,
          slot,
          label: label(slot - 1),
          releaseDay: d.kind === "WARMUP" ? Math.min(maxDays, Math.max(1, d.releaseDays?.[version] ?? inferredDay(byId[version]?.folder))) : 1,
          ...(d.scoring === "ICPC" ? {} : { points: d.points[version] ?? defaultPoints(d.scoring, slot - 1, byId[version]?.difficulty) }),
        }));
      }
      if (handles.length && d.mode === "INDIVIDUAL") {
        const result = await runStep(`Registering ${handles.length} participant(s)`, () => post<{ user: string; status: string }[]>("/api/manage/competitions/" + id + "/participants", { users: handles }));
        const missing = (result as { user: string; status: string }[]).filter((r) => r.status === "NOT_FOUND" || r.status === "INACTIVE");
        if (missing.length) setLog((l) => [...l, { text: "Not found or inactive: " + missing.map((m) => m.user).join(", "), state: "error" }]);
      }
      if (launch === "draft") { finishDraft(id!); return; }
      let teamIds: string[] | undefined;
      if (d.mode === "TEAM") {
        const team = await runStep("Creating jury check team for pre-launch verification", () => post<{ teamId: string }>("/api/teams", { name: "Jury check " + d.slug.slice(0, 80) }));
        teamIds = [(team as { teamId: string }).teamId];
      }
      const rehearsal = await runStep("Running automatic pre-launch check", () => post<{ runId: string }>("/api/manage/competitions/" + id + "/rehearsals", teamIds ? { teamIds } : {}));
      await runStep("Completing pre-launch check", () => post("/api/manage/runs/" + (rehearsal as { runId: string }).runId + "/control", { action: "end-rehearsal", reason: "Automatic pre-schedule check" }));
      const ready = await runStep("Checking readiness (approved problems & online judges)", () => get<{ ready: boolean; errors: string[] }>("/api/manage/competitions/" + id + "/readiness"));
      if (!(ready as { ready: boolean }).ready) {
        setLog((l) => [...l, ...(ready as { errors: string[] }).errors.map((e) => ({ text: e, state: "error" as const }))]);
        throw new Error("not ready");
      }
      if (launch === "startNow") await runStep("Starting the contest now", () => post("/api/manage/competitions/" + id + "/schedule", { startNow: true, visibility: d.visibility, reason: "Started from contest builder" }));
      else if (launch === "manual") await runStep("Publishing & opening registration (waiting for your Start)", () => post("/api/manage/competitions/" + id + "/schedule", { manualStart: true, visibility: d.visibility }));
      else await runStep(`Scheduling for ${when(startIso(d.startsAt))}`, () => post("/api/manage/competitions/" + id + "/schedule", { startsAt: startIso(d.startsAt), visibility: d.visibility }));
      finishDraft(id!);
    } catch {
      /* Details are shown in ProgressLog; organizer can fix and retry or open the contest page. */
    } finally {
      setBusy(false);
    }
  }

  function finishDraft(id: string) {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    navigate("/admin/contests/" + id);
  }

  const move = (i: number, delta: number) => {
    const list = [...d.problems];
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ problems: list });
  };

  const countDiff = (diff: "EASY" | "MEDIUM" | "HARD") => approved.filter((p) => (p.difficulty ?? "MEDIUM") === diff).length;
  const tz = localTimeZone();
  const canScheduleFuture = !Number.isNaN(startMs) && startMs >= serverNow() + 60_000;

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <a href="#/admin/contests" className="small">← Contests</a>
          <h1>New contest</h1>
          <p>Pick a category preset, choose problems, set your single start/end window, and launch in one click.</p>
        </div>
        <div className="row">
          {(d.touchedTiming || d.touchedScoring) && !created && (
            <button type="button" className="ghost small" onClick={() => applyPreset(d.kind, true)}>Reset to {CONTEST_FORMAT_LABEL[d.kind]} defaults</button>
          )}
          <button type="button" className="ghost small" onClick={() => { if (confirm("Discard this draft?")) { setD({ ...EMPTY, startsAt: nextHour() }); setDiffFilter("EASY"); setCreated(null); setLog([]); } }}>Start over</button>
        </div>
      </div>

      {/* 1. Category & Essentials */}
      <section className="card stack">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>1. Category &amp; basics</h3>
          <span className="small muted">Category is used for filtering on the Contests page &amp; smart defaults — everything stays customizable.</span>
        </div>
        <div className="contest-kinds" role="radiogroup" aria-label="Contest category">
          {([
            ["BASIC", "Basic", "Great for small events & beginners. Defaults to 1h 30m, filters Easy problems, unrated."],
            ["WARMUP", "Warmup", "Long-running practice round (e.g. several days). Best submission counts, no full screen, moves to Problem Set after."],
            ["STANDARD", "Normal", "Standard or multi-day competition. Defaults to 3h, ICPC scoring, rated."],
          ] as const).map(([kind, name, desc]) => (
            <button key={kind} type="button" role="radio" aria-checked={d.kind === kind} disabled={Boolean(created)}
              className={"card-flat" + (d.kind === kind ? " active" : "")}
              onClick={() => applyPreset(kind)}>
              <strong>{name}</strong>
              <span className="small muted">{desc}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-2">
          <Field label="Contest name">
            <input autoFocus value={d.title} disabled={Boolean(created)}
              onChange={(e) => set({ title: e.target.value, slug: created ? d.slug : slugify(e.target.value) })}
              placeholder={d.kind === "BASIC" ? "InfoM4th Starter Cup" : d.kind === "WARMUP" ? "InfoM4th Spring Warmup" : "InfoM4th Official Round #1"} />
          </Field>
          <Field label="Short URL name">
            <input value={d.slug} disabled={Boolean(created)} onChange={(e) => set({ slug: e.target.value })} placeholder="infom4th-starter-cup" />
          </Field>
          <Field label="Participation">
            <select value={d.mode} disabled={Boolean(created)} onChange={(e) => set({ mode: e.target.value as Draft["mode"] })}>
              <option value="INDIVIDUAL">Individual</option>
              <option value="TEAM">Teams</option>
            </select>
          </Field>
          {d.mode === "TEAM" ? (
            <Field label="Max team size">
              <input type="number" min={1} max={10} disabled={Boolean(created)} value={d.maxTeamSize} onChange={(e) => set({ maxTeamSize: Number(e.target.value) })} />
            </Field>
          ) : (
            <Field label="Who can see and join">
              <select value={d.visibility} onChange={(e) => set({ visibility: e.target.value })}>
                <option value="PUBLIC">Public — listed on Contests, anyone can register</option>
                <option value="UNLISTED">Unlisted — direct link only</option>
                <option value="PRIVATE">Private — invited / pre-registered users only</option>
              </select>
            </Field>
          )}
          {d.mode === "TEAM" && (
            <Field label="Who can see and join">
              <select value={d.visibility} onChange={(e) => set({ visibility: e.target.value })}>
                <option value="PUBLIC">Public — listed on Contests, any team can register</option>
                <option value="UNLISTED">Unlisted — direct link only</option>
                <option value="PRIVATE">Private — invited teams only</option>
              </select>
            </Field>
          )}
        </div>
      </section>

      {/* 2. Unified Timing */}
      <section className="card stack">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>2. Duration &amp; start</h3>
          <div className="filters" role="group" aria-label="Start mode">
            <button type="button" className={d.launchMode !== "scheduled" ? "active" : ""} onClick={() => set({ launchMode: "manual" })}>
              Manual start
            </button>
            <button type="button" className={d.launchMode === "scheduled" ? "active" : ""} onClick={() => set({ launchMode: "scheduled", startsAt: d.startsAt || nextHour() })}>
              Scheduled date &amp; time
            </button>
          </div>
        </div>

        <div className="row" style={{ gap: "0.4rem" }}>
          <span className="small muted" style={{ marginRight: "0.25rem" }}>Period:</span>
          {DURATION_CHIPS.map(([text, secs]) => (
            <button key={text} type="button" disabled={Boolean(created)}
              className={"small " + (d.durationSeconds === secs ? "primary" : "ghost")}
              onClick={() => setDuration(secs)}>{text}</button>
          ))}
        </div>

        {d.launchMode !== "scheduled" ? (
          <>
            <Field label="Custom period (days / hours / min)">
              <div className="row" style={{ flexWrap: "nowrap", gap: "0.35rem", maxWidth: 320 }}>
                <input type="number" min={0} max={60} disabled={Boolean(created)} value={days}
                  onChange={(e) => setDuration(Math.max(0, Number(e.target.value)) * 86400 + hours * 3600 + minutes * 60)} aria-label="Days" />
                <span className="small muted">d</span>
                <input type="number" min={0} max={23} disabled={Boolean(created)} value={hours}
                  onChange={(e) => setDuration(days * 86400 + Math.max(0, Number(e.target.value)) * 3600 + minutes * 60)} aria-label="Hours" />
                <span className="small muted">h</span>
                <input type="number" min={0} max={59} disabled={Boolean(created)} value={minutes}
                  onChange={(e) => setDuration(days * 86400 + hours * 3600 + Math.max(0, Number(e.target.value)) * 60)} aria-label="Minutes" />
                <span className="small muted">m</span>
              </div>
            </Field>
            <div className="card-flat small row-between">
              <span><strong>No scheduling needed:</strong> runs for <strong>{formatDuration(d.durationSeconds)}</strong> from the moment you hit Start.</span>
              <span className="muted">
                {showReleaseDay
                  ? `Day 1 opens at start; Day 2–Day ${maxDays} unlock automatically every 24h.`
                  : "All problems open at start & close together at end."}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-3">
              <Field label={`Start (${tz})`}>
                <input type="datetime-local" value={d.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
              </Field>
              <Field label="Period (days / hours / min)">
                <div className="row" style={{ flexWrap: "nowrap", gap: "0.35rem" }}>
                  <input type="number" min={0} max={60} disabled={Boolean(created)} value={days}
                    onChange={(e) => setDuration(Math.max(0, Number(e.target.value)) * 86400 + hours * 3600 + minutes * 60)} aria-label="Days" />
                  <span className="small muted">d</span>
                  <input type="number" min={0} max={23} disabled={Boolean(created)} value={hours}
                    onChange={(e) => setDuration(days * 86400 + Math.max(0, Number(e.target.value)) * 3600 + minutes * 60)} aria-label="Hours" />
                  <span className="small muted">h</span>
                  <input type="number" min={0} max={59} disabled={Boolean(created)} value={minutes}
                    onChange={(e) => setDuration(days * 86400 + hours * 3600 + Math.max(0, Number(e.target.value)) * 60)} aria-label="Minutes" />
                  <span className="small muted">m</span>
                </div>
              </Field>
              <Field label={`End (${tz})`} hint="Adjust end directly or change the period.">
                <input type="datetime-local" value={endsAtInput} disabled={Boolean(created) || Number.isNaN(startMs)}
                  onChange={(e) => {
                    const pickedEnd = fromZoneInput(e.target.value);
                    if (!Number.isNaN(pickedEnd) && !Number.isNaN(startMs) && pickedEnd > startMs) {
                      setDuration(Math.round((pickedEnd - startMs) / 1000));
                    }
                  }} />
              </Field>
            </div>
            <div className="card-flat small row-between">
              <span>
                <strong>Scheduled window ({tz}):</strong>{" "}
                {!Number.isNaN(startMs) ? `${when(startIso(d.startsAt))} → ${when(new Date(endMs).toISOString())}` : "Pick a start date & time"}{" "}
                · <strong>{formatDuration(d.durationSeconds)}</strong>
              </span>
              <span className="muted">
                {showReleaseDay
                  ? `Day 1 opens at start; Day 2–Day ${maxDays} unlock automatically every 24h.`
                  : "All problems open at start & close together at end."}
              </span>
            </div>
          </>
        )}
      </section>

      {/* 3. Problem Picker */}
      <section className="card stack">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>3. Problems ({d.problems.length} selected)</h3>
          <div className="row" style={{ gap: "0.5rem" }}>
            <a className="small" href="#/admin/problems">Open Problem Bank</a>
            <a className="small" href="#/admin/problems/new">New problem</a>
          </div>
        </div>
        {publicSelectedCount > 0 && (
          <div className="notice warn small" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
            <AdminIcon name="warning" size={16} />
            <span>
              <strong>Visibility warning:</strong> {publicSelectedCount} selected problem{publicSelectedCount === 1 ? " is" : "s are"} already visible to students in Practice, a TD, or a Mission.
            </span>
          </div>
        )}
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <div className="stack" style={{ gap: "0.6rem" }}>
            <div className="row" style={{ gap: "0.5rem" }}>
              <input placeholder="Search by title, slug, topic, or collection…" value={problemSearch} onChange={(e) => setProblemSearch(e.target.value)} style={{ flex: 1 }} />
              {!created && filteredProblems.some((p) => !d.problems.includes(p.version_id)) && (
                <button type="button" className="small ghost" onClick={() => {
                  const add = filteredProblems.map((p) => p.version_id).filter((id) => !d.problems.includes(id));
                  set({ problems: [...d.problems, ...add] });
                }}>+ Add shown ({filteredProblems.filter((p) => !d.problems.includes(p.version_id)).length})</button>
              )}
            </div>
            <div className="row" style={{ gap: "0.5rem" }}>
              <div className="filters">
                {([
                  ["", `All (${approved.length})`],
                  ["EASY", `Easy (${countDiff("EASY")})`],
                  ["MEDIUM", `Medium (${countDiff("MEDIUM")})`],
                  ["HARD", `Hard (${countDiff("HARD")})`],
                ] as const).map(([val, text]) => (
                  <button key={val || "all"} type="button" className={diffFilter === val ? "active" : ""} onClick={() => setDiffFilter(val)}>{text}</button>
                ))}
              </div>
              {allFolders.length > 0 && (
                <SearchSelect
                  compact
                  value={folderFilter}
                  onChange={setFolderFilter}
                  ariaLabel="Filter by collection"
                  placeholder="All collections"
                  searchPlaceholder="Search collections…"
                  options={[
                    { value: "", label: "All collections", meta: approved.length },
                    ...allFolders.map((fl) => ({
                      value: fl,
                      label: fl,
                      meta: approved.filter((p) => p.folder === fl || p.folder?.startsWith(fl + "/")).length,
                    })),
                    { value: "__NONE__", label: "Uncollected", meta: approved.filter((p) => !p.folder).length },
                  ]}
                />
              )}
              <label className="check small">
                <input type="checkbox" checked={privateOnly} onChange={(e) => setPrivateOnly(e.target.checked)} />
                Private only
              </label>
            </div>
            {lab.loading ? <Loading /> : approved.length === 0 ? (
              <Empty>No approved problems yet. Import and approve problems in the Problem Bank first.</Empty>
            ) : filteredProblems.length === 0 ? (
              <Empty>No approved problem matches this filter. <button type="button" className="ghost small" onClick={() => { setDiffFilter(""); setPrivateOnly(false); setFolderFilter(""); setProblemSearch(""); }}>Show all</button></Empty>
            ) : (
              <div className="stack" style={{ gap: "0.4rem", maxHeight: 380, overflowY: "auto", paddingRight: 4 }}>
                {filteredProblems.map((p) => {
                  const checked = d.problems.includes(p.version_id);
                  return (
                    <label key={p.version_id} className="check card-flat" style={{ justifyContent: "space-between", cursor: created ? "default" : "pointer", padding: "0.55rem 0.75rem" }}>
                      <span className="row" style={{ gap: "0.5rem", minWidth: 0 }}>
                        <input type="checkbox" disabled={Boolean(created)} checked={checked}
                          onChange={(e) => set({ problems: e.target.checked ? [...d.problems, p.version_id] : d.problems.filter((x) => x !== p.version_id) })} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <strong>{p.title}</strong>
                          <span className="small muted mono" style={{ marginLeft: "0.4rem" }}>{p.slug}</span>
                        </span>
                      </span>
                      <span className="row" style={{ gap: "0.35rem", flexShrink: 0 }}>
                        {p.folder && <span className="collection-pill" title={p.folder}>{p.folder}</span>}
                        {isPublic(p) && <Badge tone="warn">Public</Badge>}
                        <DifficultyPill value={p.difficulty ?? "MEDIUM"} />
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="stack" style={{ gap: "0.5rem" }}>
            <div className="row-between">
              <strong>Contest problem set ({d.problems.length})</strong>
              <span className="row" style={{ gap: "0.35rem" }}>
                {!created && showReleaseDay && d.problems.length > 1 && (
                  <button type="button" className="ghost small" title="Distribute problems evenly across Day 1 to Day N" onClick={() => {
                    const next: Record<string, number> = { ...d.releaseDays };
                    d.problems.forEach((id, idx) => { next[id] = Math.min(maxDays, Math.floor((idx * maxDays) / d.problems.length) + 1); });
                    set({ releaseDays: next });
                  }}>Spread across {maxDays} days</button>
                )}
                {!created && d.problems.length > 0 && <button type="button" className="ghost small" onClick={() => set({ problems: [] })}>Clear all</button>}
              </span>
            </div>
            {showReleaseDay && (
              <div className="small muted">Day 1 opens immediately when the contest starts; Day 2 opens 24h later, and so on.</div>
            )}
            {d.problems.length === 0 ? (
              <Empty>Tick problems on the left{d.kind === "BASIC" ? " (filtered to Easy for Basic events)" : ""}. Letters A, B, C… are assigned automatically.</Empty>
            ) : (
              d.problems.map((v, i) => {
                const info = byId[v];
                const relDay = Math.min(maxDays, Math.max(1, d.releaseDays?.[v] ?? inferredDay(info?.folder)));
                return (
                  <div key={v} className="row-between card-flat">
                    <span className="row" style={{ gap: "0.5rem" }}>
                      <span className="problem-letter">{label(i)}</span>
                      <strong>{info?.title ?? v}</strong>
                      {info?.difficulty && <DifficultyPill value={info.difficulty} />}
                    </span>
                    <span className="row" style={{ gap: "0.4rem", flexWrap: "nowrap" }}>
                      {showReleaseDay && (
                        <select aria-label={`Release day for ${info?.title ?? label(i)}`} disabled={Boolean(created)}
                          style={{ width: "auto" }} value={relDay}
                          onChange={(e) => set({ releaseDays: { ...d.releaseDays, [v]: Number(e.target.value) } })}>
                          {Array.from({ length: maxDays }, (_, k) => k + 1).map((dayNum) => (
                            <option key={dayNum} value={dayNum}>Day {dayNum}</option>
                          ))}
                        </select>
                      )}
                      {d.scoring !== "ICPC" && (
                        <label className="row small" style={{ flexWrap: "nowrap" }}>
                          pts
                          <input type="number" min={1} max={100000} style={{ width: 82 }} disabled={Boolean(created)}
                            value={d.points[v] ?? defaultPoints(d.scoring, i, info?.difficulty)}
                            onChange={(e) => set({ points: { ...d.points, [v]: Number(e.target.value) } })} />
                        </label>
                      )}
                      {!created && (
                        <>
                          <button type="button" className="small ghost" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                          <button type="button" className="small ghost" onClick={() => move(i, 1)} disabled={i === d.problems.length - 1} title="Move down">↓</button>
                          <button type="button" className="small ghost" onClick={() => set({ problems: d.problems.filter((x) => x !== v) })} title="Remove">✕</button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* 4. Options & Advanced Settings */}
      <section className="card stack">
        <h3 style={{ margin: 0 }}>4. Scoring &amp; options</h3>
        <div className="row" style={{ gap: "1.25rem" }}>
          <label className="check small">
            <input type="checkbox" disabled={Boolean(created)} checked={d.requireFullscreen}
              onChange={(e) => set({ requireFullscreen: e.target.checked, touchedTiming: true })} />
            Require full screen in the arena
          </label>
          <label className="check small">
            <input type="checkbox" disabled={Boolean(created)} checked={d.rated}
              onChange={(e) => set({ rated: e.target.checked, touchedScoring: true })} />
            Counts for player rating
          </label>
          <label className="check small">
            <input type="checkbox" disabled={Boolean(created)} checked={d.publishToPractice}
              onChange={(e) => set({ publishToPractice: e.target.checked, touchedScoring: true })} />
            Publish problems to Problem Set when contest ends
          </label>
        </div>

        <details>
          <summary className="small" style={{ cursor: "pointer" }}>
            <strong>Scoring details, languages, pre-registered participants &amp; rules</strong>{" "}
            <span className="muted">— {SCORING_INFO[d.scoring].name} · freeze {d.freezeMinutes}m · {d.languages.length} languages{handles.length ? ` · ${handles.length} pre-registered` : ""}</span>
          </summary>
          <div className="stack" style={{ marginTop: "1rem" }}>
            <div className="grid grid-3">
              <Field label="Scoring system" hint={SCORING_INFO[d.scoring].summary}>
                <select value={d.scoring} disabled={Boolean(created)} onChange={(e) => {
                  const next = e.target.value as Draft["scoring"];
                  const defaultRuleValues = Object.values(RULES_BY_SCORING);
                  set({
                    scoring: next,
                    points: {},
                    rules: defaultRuleValues.includes(d.rules) ? RULES_BY_SCORING[next] : d.rules,
                    touchedScoring: true,
                  });
                }}>
                  <option value="ICPC">ICPC — solved count, then time + penalty</option>
                  <option value="IOI">IOI — best submission / partial points, no time penalty</option>
                  <option value="CODEFORCES">Codeforces — points decrease over time</option>
                  <option value="ATCODER">AtCoder — fixed points, time tie-break</option>
                </select>
              </Field>
              <Field label="Freeze scoreboard before end (min)" hint="0 = never freeze">
                <input type="number" min={0} max={Math.max(0, Math.floor(d.durationSeconds / 60) - 1)} disabled={Boolean(created)}
                  value={d.freezeMinutes} onChange={(e) => set({ freezeMinutes: Number(e.target.value), touchedTiming: true })} />
              </Field>
              {d.scoring === "ICPC" && (
                <Field label="Penalty per rejected attempt (min)">
                  <input type="number" min={0} disabled={Boolean(created)} value={d.penaltyMinutes}
                    onChange={(e) => set({ penaltyMinutes: Number(e.target.value), touchedScoring: true })} />
                </Field>
              )}
            </div>
            {d.scoring !== "IOI" && (
              <label className="check small">
                <input type="checkbox" disabled={Boolean(created)} checked={d.penalizeCompilationErrors}
                  onChange={(e) => set({ penalizeCompilationErrors: e.target.checked })} />
                Compilation errors also count as rejected attempts
              </label>
            )}
            <Field label="Allowed languages">
              <LanguagePicker value={d.languages} onChange={(languages) => !created && set({ languages })} />
            </Field>
            {d.mode === "INDIVIDUAL" && (
              <Field label="Pre-register participants (optional — handles or emails, one per line or comma-separated)"
                hint={`${handles.length} entered. Public contests also allow self-registration in the lobby.`}>
                <textarea rows={3} className="mono" value={d.participants} onChange={(e) => set({ participants: e.target.value })} placeholder={"student1\nali@example.com"} />
              </Field>
            )}
            <div className="grid grid-2">
              <Field label="Lobby description (Markdown, optional)">
                <textarea rows={3} value={d.description} disabled={Boolean(created)} onChange={(e) => set({ description: e.target.value })} />
              </Field>
              <Field label="Rules (Markdown)">
                <textarea rows={3} value={d.rules} disabled={Boolean(created)} onChange={(e) => set({ rules: e.target.value })} />
              </Field>
            </div>
          </div>
        </details>
      </section>

      {/* 5. Launch Bar */}
      <section className="card stack accent">
        <div className="small">
          <strong>{d.title || "Untitled contest"}</strong> · <Badge tone="info">{CONTEST_FORMAT_LABEL[d.kind]}</Badge> · {SCORING_INFO[d.scoring].name} · {d.mode === "TEAM" ? `Teams ≤${d.maxTeamSize}` : "Individual"} ·{" "}
          <strong>{formatDuration(d.durationSeconds)}</strong> · {d.problems.length} problem{d.problems.length === 1 ? "" : "s"}
          {d.problems.length > 0 ? ` (${d.problems.map((_, i) => label(i)).join(", ")})` : ""} · {d.requireFullscreen ? "Full screen on" : "No full screen"} · {d.rated ? "Rated" : "Unrated"}
        </div>
        {issues.length > 0 && (
          <div className="notice warn">
            <ul className="small" style={{ margin: 0 }}>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        )}
        {d.launchMode === "scheduled" && !canScheduleFuture && issues.length === 0 && (
          <div className="notice warn small">Pick a future start date &amp; time, or switch back to <strong>Start whenever I hit Start</strong>.</div>
        )}
        <div className="row">
          {d.launchMode !== "scheduled" ? (
            <>
              <button type="button" className="primary" disabled={busy || issues.length > 0} onClick={() => finish("manual")}>
                Publish &amp; open registration
              </button>
              <button type="button" disabled={busy || issues.length > 0} onClick={() => finish("startNow")}>
                Create &amp; start immediately ({formatDuration(d.durationSeconds)})
              </button>
              <button type="button" className="ghost" disabled={busy || issues.length > 0} onClick={() => finish("draft")}>
                Save as private draft
              </button>
            </>
          ) : (
            <>
              <button type="button" className="primary" disabled={busy || issues.length > 0 || !canScheduleFuture} onClick={() => finish("scheduled")}>
                Create &amp; schedule ({!Number.isNaN(startMs) ? when(startIso(d.startsAt)) : "pick start"})
              </button>
              <button type="button" disabled={busy || issues.length > 0} onClick={() => finish("manual")}>
                Open registration (manual start)
              </button>
              <button type="button" className="ghost" disabled={busy || issues.length > 0} onClick={() => finish("draft")}>
                Save as draft
              </button>
            </>
          )}
          {created && <a className="btn ghost" href={"#/admin/contests/" + created}>Open contest page</a>}
        </div>
        <ProgressLog lines={log} />
        {log.some((l) => l.state === "error") && created && (
          <div className="notice small">The contest draft was created on the server. Fix the issue above and retry, or open the contest page to finish launching.</div>
        )}
      </section>
    </div>
  );
}
