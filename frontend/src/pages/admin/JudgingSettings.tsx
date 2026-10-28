import { useEffect, useState } from "react";
import { ApiError, patch, post } from "../../api";
import { useData, useToast } from "../../app";
import { Badge, ErrorBox, Field, Loading, Meter, ReasonDialog, Stat, ago } from "../../ui";

type Settings = {
  officialConcurrencyLimit: number | null; internalConcurrencyLimit: number | null;
  pendingSubmissionsPerUser: number; submissionsPerMinute: number; maxQueuedSubmissions: number;
  version: number; updatedAt: string;
};
type Lane = {
  configuredLimit: number | null; registeredMaximum: number; workerCapacity: number; effectiveCapacity: number;
  running: number; availableSlots: number; overTarget: boolean; onlineWorkers: number; constraints: string[];
};
type Worker = {
  id: string; name: string; lane: string; hostId: string; status: string; online: boolean; draining: boolean;
  lastHeartbeatAt: string; maxConcurrency: number; defaultConcurrency: number; configuredConcurrency: number | null;
  effectiveConcurrency: number; running: number; availableSlots: number; overTarget: boolean;
  reportedActive: number | null; reportedTarget: number | null; slotMemoryMb: number; laneMemoryBudgetMb: number;
  hostMemoryBudgetMb: number; settingsVersion: number; constraints: string[]; detectedCpus: number | null; detectedMemoryMb: number | null; absoluteMaxConcurrency: number; runtimes: Record<string, { verified: boolean; imageId: string }>;
};
type Host = { hostId: string; memoryBudgetMb: number; configuredDemandMb: number; reservedMb: number; overcommitted: boolean; lanes: string[]; workers: string[] };
type Overview = {
  settings: Settings; lanes: Record<"official" | "internal", Lane>; workers: Worker[]; hosts: Host[];
  queue: {
    databaseJobs: Record<string, { queued: number; retry: number; running: number; oldestWaitingCreatedAt?: string }>;
    unpublishedDispatchIntents: Record<string, number>;
    broker: { available: boolean; reason?: string; note?: string; official?: { readyMessages: number; consumers: number }; internal?: { readyMessages: number; consumers: number } };
  };
  explanation: string[];
};

type Form = { official: string; officialUnlimited: boolean; internal: string; internalUnlimited: boolean; pending: string; perMinute: string; maxQueued: string };
const formFrom = (s: Settings): Form => ({
  official: String(s.officialConcurrencyLimit ?? ""), officialUnlimited: s.officialConcurrencyLimit == null,
  internal: String(s.internalConcurrencyLimit ?? ""), internalUnlimited: s.internalConcurrencyLimit == null,
  pending: String(s.pendingSubmissionsPerUser), perMinute: String(s.submissionsPerMinute), maxQueued: String(s.maxQueuedSubmissions),
});

export default function JudgingSettings() {
  const overview = useData<Overview>("/api/admin/judging/settings", 5000);
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [conflict, setConflict] = useState("");
  const data = overview.data;

  // Live polling refreshes the numbers but never overwrites unsaved edits.
  useEffect(() => {
    if (data && (!dirty || baseVersion === null)) { setForm(formFrom(data.settings)); setBaseVersion(data.settings.version); }
  }, [data, dirty, baseVersion]);
  if (overview.loading || !form) return <Loading />;
  if (!data) return <ErrorBox error={overview.error} />;
  const update = (patchForm: Partial<Form>) => { setForm({ ...form, ...patchForm }); setDirty(true); };
  const changes = (): Record<string, number | null> => {
    const result: Record<string, number | null> = {};
    const s = data.settings;
    const official = form.officialUnlimited ? null : Number(form.official);
    const internal = form.internalUnlimited ? null : Number(form.internal);
    if (official !== s.officialConcurrencyLimit) result.officialConcurrencyLimit = official;
    if (internal !== s.internalConcurrencyLimit) result.internalConcurrencyLimit = internal;
    if (Number(form.pending) !== s.pendingSubmissionsPerUser) result.pendingSubmissionsPerUser = Number(form.pending);
    if (Number(form.perMinute) !== s.submissionsPerMinute) result.submissionsPerMinute = Number(form.perMinute);
    if (Number(form.maxQueued) !== s.maxQueuedSubmissions) result.maxQueuedSubmissions = Number(form.maxQueued);
    return result;
  };
  const pendingChanges = changes();
  const remoteChanged = dirty && baseVersion !== null && data.settings.version !== baseVersion;

  async function save(reason: string) {
    try {
      const next = await patch<Overview & { warnings?: string[] }>("/api/admin/judging/settings", { ...pendingChanges, version: baseVersion, reason });
      for (const warning of next.warnings ?? []) toast("info", warning.replace(/^WARNING: /, ""));
      overview.setData(next);
      setDirty(false); setBaseVersion(next.settings.version); setForm(formFrom(next.settings)); setConflict(""); setConfirming(false);
      toast("success", "Judging settings saved. Workers apply them within a few seconds.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { setConflict(e.message); setConfirming(false); }
      else toast("error", e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Judge infrastructure</div>
          <h1>Judging settings</h1>
          <p>A <strong>slot</strong> is one submission being compiled and run at a time. Slots are not participants and not servers:
            100 participants can share 16 slots — extra submissions wait in the queue and run in order.</p>
        </div>
        <span className="small muted">Live · refreshes every 5s · version {data.settings.version}</span>
      </div>

      <section className="card stack">
        <h3 style={{ margin: 0 }}>How many submissions are judged at the same time?</h3>
        <div className="grid grid-2">
          <div className="small">
            <strong>Before deploying (recommended):</strong> edit <code>cp-platform/.env</code> on the server and set
            <pre className="card-flat mono" style={{ margin: "0.4rem 0" }}>{"OFFICIAL_JUDGE_SLOTS=4   # contest submissions at once\nINTERNAL_JUDGE_SLOTS=1   # practice / problem testing"}</pre>
            then run <code>docker compose --profile judge up -d</code>. Use about one slot per CPU core you can spare. The full guide is <code>docs/DEPLOY_VPS.md</code>.
          </div>
          <div className="small">
            <strong>During an event (optional):</strong> change a worker's number in the <em>Workers</em> table below — it applies in a few seconds without a restart.
            The two "global limit" boxes cap the total across all workers; leave them on "no global limit" unless you run several judge machines.
          </div>
        </div>
      </section>
      {conflict && (
        <div className="notice bad row-between">
          <span>{conflict}</span>
          <button className="small" onClick={() => { setDirty(false); setBaseVersion(null); setConflict(""); overview.reload(); }}>Discard my edits and reload</button>
        </div>
      )}
      {remoteChanged && !conflict && <div className="notice warn">Another administrator saved settings while you were editing. Saving now will be rejected; reload to review their values.</div>}

      <div className="grid grid-2">
        {(["official", "internal"] as const).map((lane) => {
          const l = data.lanes[lane];
          const unlimitedKey = lane === "official" ? "officialUnlimited" : "internalUnlimited";
          return (
            <section key={lane} className={"card lane-card " + lane}>
              <div className="row-between">
                <h3 style={{ margin: 0 }}>{lane === "official" ? "Concurrent official submissions" : "Concurrent internal submissions"}</h3>
                {l.overTarget ? <Badge tone="bad">Over target</Badge> : l.availableSlots > 0 ? <Badge tone="ok">{l.availableSlots} free</Badge> : <Badge tone="warn">Full</Badge>}
              </div>
              <p className="small muted" style={{ margin: "0.25rem 0 0.75rem" }}>
                {lane === "official" ? "Official contest submissions. Shared by all official workers." : "Practice, rehearsals, problem validation and rejudges of non-official runs. Separate from official capacity."}
              </p>
              <div className="capacity-numbers">
                <Stat label="Running now" value={l.running} />
                <Stat label="Effective" value={l.effectiveCapacity} hint="usable slots" />
                <Stat label="Worker slots" value={l.workerCapacity} hint={`${l.onlineWorkers} online worker(s)`} />

              </div>
              <Meter value={l.running} max={l.effectiveCapacity} />
              <div className="row" style={{ marginTop: "1rem", alignItems: "flex-end" }}>
                <Field label="Global limit (all workers)" hint="Maximum simultaneous submissions in this lane across every judge server.">
                  <input type="number" min={0} max={1024} disabled={form[unlimitedKey]} value={form[lane]}
                    onChange={(e) => update({ [lane]: e.target.value } as Partial<Form>)} style={{ maxWidth: 140 }} />
                </Field>
                <label className="check small"><input type="checkbox" checked={form[unlimitedKey]} onChange={(e) => update({ [unlimitedKey]: e.target.checked } as Partial<Form>)} /> No global limit (use all worker slots)</label>
              </div>
              {l.constraints.length > 0 && (
                <div className="stack" style={{ marginTop: "0.75rem", gap: "0.35rem" }}>
                  {l.constraints.map((c) => <div key={c} className={"constraint" + (c.startsWith("OVER_TARGET") ? " over" : "")}>{c}</div>)}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section className="card">
        <h3>Submission admission</h3>
        <p className="small muted">Checked when a submission is created. Rejected submissions return HTTP 429 with a clear message; nothing is stored.</p>
        <div className="grid grid-3">
          <Field label="Pending submissions per user" hint="Unfinished jobs (queued, running, retrying) for submissions created by that user, in any context.">
            <input type="number" min={1} max={100} value={form.pending} onChange={(e) => update({ pending: e.target.value })} />
          </Field>
          <Field label="Submissions per minute" hint="Contest and practice submissions a user created in the last 60 seconds. Replays of the same request do not count.">
            <input type="number" min={1} max={600} value={form.perMinute} onChange={(e) => update({ perMinute: e.target.value })} />
          </Field>
          <Field label="Maximum queued submissions" hint="Platform-wide unfinished jobs in both lanes, including rejudges and validation. New submissions are refused at this level.">
            <input type="number" min={1} max={100000} value={form.maxQueued} onChange={(e) => update({ maxQueued: e.target.value })} />
          </Field>
        </div>
        <div className="row" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
          {dirty && <button onClick={() => { setDirty(false); setForm(formFrom(data.settings)); setBaseVersion(data.settings.version); }}>Discard</button>}
          <button className="primary" disabled={Object.keys(pendingChanges).length === 0} onClick={() => setConfirming(true)}>Save settings…</button>
        </div>
      </section>

      <Workers workers={data.workers} reload={overview.reload} />

      <details className="card">
        <summary><strong>Advanced</strong> <span className="small muted">— judge hosts, memory budgets and queue internals</span></summary>
      <div className="grid grid-2" style={{ marginTop: "1rem" }}>
        <section className="card">
          <h3>Judge hosts</h3>
          <p className="small muted">Workers sharing a host identity share one memory budget. Budgets are deployment configuration, not measured hardware.</p>
          {data.hosts.length === 0 ? <div className="empty">No online hosts.</div> : (
            <table>
              <thead><tr><th>Host</th><th className="right">Budget</th><th className="right">Configured demand</th><th className="right">Reserved now</th></tr></thead>
              <tbody>{data.hosts.map((h) => (
                <tr key={h.hostId}>
                  <td><strong className="mono">{h.hostId}</strong><div className="small muted">{h.workers.join(", ")}</div></td>
                  <td className="right mono">{h.memoryBudgetMb} MiB</td>
                  <td className="right mono">{h.configuredDemandMb} MiB {h.overcommitted && <Badge tone="warn">exceeds budget</Badge>}</td>
                  <td className="right mono">{h.reservedMb} MiB</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h3>Queue</h3>
          <table>
            <thead><tr><th>Lane</th><th className="right">DB queued</th><th className="right">DB retry</th><th className="right">DB running</th><th className="right">Not yet published</th><th className="right">Broker ready</th></tr></thead>
            <tbody>{(["official", "internal"] as const).map((lane) => {
              const j = data.queue.databaseJobs[lane];
              return (
                <tr key={lane}>
                  <td>{lane}{j?.oldestWaitingCreatedAt && <div className="small muted">oldest waiting {ago(j.oldestWaitingCreatedAt)}</div>}</td>
                  <td className="right mono">{j?.queued ?? 0}</td><td className="right mono">{j?.retry ?? 0}</td><td className="right mono">{j?.running ?? 0}</td>
                  <td className="right mono">{data.queue.unpublishedDispatchIntents[lane] ?? 0}</td>
                  <td className="right mono">{data.queue.broker.available ? data.queue.broker[lane]?.readyMessages ?? 0 : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="small muted">"DB" counts are judging jobs in PostgreSQL (the source of truth). "Broker ready" counts RabbitMQ messages waiting for a consumer.
            {" "}{data.queue.broker.available ? data.queue.broker.note : data.queue.broker.reason}</p>
        </section>
      </div>

      <section className="card-flat small">
        <h3>How limits apply</h3>
        <ul>{data.explanation.map((e) => <li key={e}>{e}</li>)}
          <li>Live settings (global limits, worker execution limits, drain, admission) apply without restarts. Physical ceilings (JUDGE_MAX_SLOTS, memory budgets, host identity) need a worker restart.</li></ul>
      </section>
      </details>

      {confirming && (
        <ReasonDialog title="Save judging settings" confirm="Save" onClose={() => setConfirming(false)} onSubmit={save}
          description={<ul className="small">{Object.entries(pendingChanges).map(([k, v]) => <li key={k}><span className="mono">{k}</span> → <strong>{v === null ? "no global limit" : v}</strong></li>)}</ul>} />
      )}
    </div>
  );
}

function Workers({ workers, reload }: { workers: Worker[]; reload: () => void }) {
  const toast = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [action, setAction] = useState<{ worker: Worker; kind: "limit" | "reset" | "drain" | "resume" } | null>(null);
  async function apply(reason: string) {
    if (!action) return;
    const { worker, kind } = action;
    try {
      if (kind === "drain" || kind === "resume") {
        await post(`/api/admin/judge/workers/${worker.id}/${kind}`, { reason });
      } else {
        const result = await patch<{ warnings: string[] }>(`/api/admin/judging/workers/${worker.id}/settings`, {
          version: worker.settingsVersion, reason, desiredConcurrency: kind === "reset" ? null : Number(edits[worker.id]),
        });
        for (const warning of result.warnings ?? []) toast("info", warning);
        setEdits((all) => { const next = { ...all }; delete next[worker.id]; return next; });
      }
      toast("success", "Worker updated. It applies the change at its next heartbeat.");
      setAction(null);
      reload();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Update failed");
      if (e instanceof ApiError && e.status === 409) { setAction(null); reload(); }
    }
  }
  return (
    <section className="card">
      <h3>Workers</h3>
      <p className="small muted">Worker execution limit = simultaneous submissions on that worker. Set any number up to 256; it applies within seconds without a restart. Values above the detected CPU cores or memory are allowed but shown as warnings, because parallel runs then compete for the machine and time limits become less reliable.</p>
      {workers.length === 0 ? <div className="empty">No worker has registered yet. Start the judge profile on a Linux host.</div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Worker</th><th>Status</th><th className="right">Running / effective</th><th>Worker execution limit</th><th>Machine</th><th className="right">Slot memory</th><th>Heartbeat</th><th /></tr></thead>
            <tbody>{workers.map((w) => (
              <tr key={w.id}>
                <td>
                  <strong>{w.name}</strong> <Badge tone={w.lane === "official" ? "info" : "neutral"}>{w.lane}</Badge>
                  <div className="small muted mono">host {w.hostId}</div>
                  {w.constraints.map((c) => <div key={c} className={"constraint" + (c.startsWith("OVER_TARGET") ? " over" : "")} style={{ marginTop: 4 }}>{c.replace(/^WARNING: /, "⚠ ")}</div>)}
                </td>
                <td>{!w.online ? <Badge tone="bad">Offline</Badge> : w.draining ? <Badge tone="warn">Draining</Badge> : <Badge tone="ok">Online</Badge>}</td>
                <td className="right mono">{w.running} / {w.effectiveConcurrency}{w.reportedActive != null && <div className="small muted">worker reports {w.reportedActive}/{w.reportedTarget}</div>}</td>
                <td>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <input type="number" min={1} max={w.absoluteMaxConcurrency ?? 256} style={{ width: 80 }}
                      value={edits[w.id] ?? String(w.configuredConcurrency ?? w.defaultConcurrency)}
                      onChange={(e) => setEdits({ ...edits, [w.id]: e.target.value })} />
                    <button className="small" disabled={edits[w.id] === undefined || Number(edits[w.id]) === (w.configuredConcurrency ?? w.defaultConcurrency)}
                      onClick={() => setAction({ worker: w, kind: "limit" })}>Set</button>
                  </div>
                  <div className="small muted">{w.configuredConcurrency == null ? `worker default (${w.defaultConcurrency})` : <>saved by admin · <a href="#" onClick={(e) => { e.preventDefault(); setAction({ worker: w, kind: "reset" }); }}>reset</a></>}</div>
                </td>
                <td className="small">{w.detectedCpus ? w.detectedCpus + " cores" : "cores ?"} · {w.detectedMemoryMb ? Math.round(w.detectedMemoryMb / 1024) + " GB" : "RAM ?"}<div className="muted">default max {w.maxConcurrency}</div></td>
                <td className="right mono">{w.slotMemoryMb} MiB</td>
                <td className="small">{ago(w.lastHeartbeatAt)}</td>
                <td className="right">
                  {w.draining
                    ? <button className="small" onClick={() => setAction({ worker: w, kind: "resume" })}>Resume</button>
                    : <button className="small danger" onClick={() => setAction({ worker: w, kind: "drain" })}>Drain</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {action && (
        <ReasonDialog
          title={{ limit: `Set ${action.worker.name} to ${edits[action.worker.id]} slots`, reset: `Reset ${action.worker.name} to its default`, drain: `Drain ${action.worker.name}`, resume: `Resume ${action.worker.name}` }[action.kind]}
          danger={action.kind === "drain"}
          description={{
            limit: "Increasing starts more slots on the worker within a few seconds. Decreasing lets running submissions finish; no new work starts until the worker is below the new limit.",
            reset: `The worker returns to its deployment default of ${action.worker.defaultConcurrency} slots.`,
            drain: "Running submissions finish normally. The worker stops taking new work, even after restarts, until resumed.",
            resume: "The worker starts taking new work again at its configured limit.",
          }[action.kind]}
          onClose={() => setAction(null)} onSubmit={apply} />
      )}
    </section>
  );
}
