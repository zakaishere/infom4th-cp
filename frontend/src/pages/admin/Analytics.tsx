import { useState } from "react";
import { useAuth, useData } from "../../app";
import { Badge, Empty, ErrorBox, LANGUAGE_NAMES, Loading, Meter, Stat, VERDICTS, ago, when } from "../../ui";

type Count = { key: string; count: number; accepted?: number };
type Num = number | null | undefined;

const pct = (v: Num) => (v == null ? "—" : Math.round(v * 100) + "%");
const ms = (v: Num) => (v == null ? "—" : v < 1000 ? Math.round(v) + " ms" : (v / 1000).toFixed(v < 10000 ? 1 : 0) + " s");
const mb = (v: Num) => (v == null ? "—" : v >= 1024 ? (v / 1024).toFixed(1) + " GB" : Math.round(v) + " MB");
const n = (v: Num) => (v == null ? "—" : Number(v).toLocaleString());
const duration = (s: number) => (s >= 86400 ? Math.floor(s / 86400) + "d " : "") + Math.floor((s % 86400) / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
const tone = (ratio: Num, warn = 0.7, bad = 0.9) => (ratio == null ? undefined : ratio >= bad ? "bad" : ratio >= warn ? "warn" : "ok");
const label = (key: string) => VERDICTS[key]?.label ?? LANGUAGE_NAMES[key] ?? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ");

/**
 * Line chart with crosshair tooltip. One y-axis; a second series is drawn as a lighter
 * area of the same hue (e.g. "accepted" under "submissions") and named in the legend.
 */
function TimeChart({ rows, value, area, format = n, max, title, names }: {
  rows: Record<string, any>[]; value: string; area?: string; format?: (v: Num) => string; max?: number; title: string; names?: [string, string];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 170, L = 44, B = 22, T = 8;
  if (!rows.length) return <section className="card stack"><h3 style={{ margin: 0 }}>{title}</h3><span className="small muted">No data in this range yet.</span></section>;
  const values = rows.map((r) => Number(r[value] ?? 0));
  const top = max ?? Math.max(1, ...values, ...(area ? rows.map((r) => Number(r[area] ?? 0)) : []));
  const t0 = new Date(rows[0].at).getTime(), t1 = Math.max(t0 + 1, new Date(rows[rows.length - 1].at).getTime());
  const x = (i: number) => L + ((new Date(rows[i].at).getTime() - t0) / (t1 - t0)) * (W - L - 4);
  const y = (v: number) => T + (1 - Math.min(1, v / top)) * (H - T - B);
  const path = (key: string) => rows.map((r, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(Number(r[key] ?? 0)).toFixed(1)).join(" ");
  const areaPath = area ? path(area) + ` L${x(rows.length - 1)} ${H - B} L${x(0)} ${H - B} Z` : "";
  const span = t1 - t0;
  const tick = (t: number) => new Date(t).toLocaleString(undefined, span > 2 * 86400000 ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" });
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    rows.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  };
  const h = hover != null ? rows[hover] : null;
  return (
    <section className="card stack analytics-chart">
      <div className="row-between">
        <h3 style={{ margin: 0 }}>{title}</h3>
        {names && <div className="chart-legend small"><span><i className="swatch line" />{names[0]}</span><span><i className="swatch area" />{names[1]}</span></div>}
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W - 4} y1={y(top * f)} y2={y(top * f)} className="chart-grid" />
              <text x={L - 6} y={y(top * f) + 4} className="chart-axis" textAnchor="end">{format(top * f)}</text>
            </g>
          ))}
          {[t0, (t0 + t1) / 2, t1].map((t, i) => <text key={i} x={L + ((t - t0) / (t1 - t0)) * (W - L - 4)} y={H - 6} className="chart-axis" textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>{tick(t)}</text>)}
          {area && <path d={areaPath} className="chart-area" />}
          <path d={path(value)} className="chart-line" />
          {h && <>
            <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={H - B} className="chart-cross" />
            <circle cx={x(hover!)} cy={y(Number(h[value] ?? 0))} r={4} className="chart-dot" />
          </>}
        </svg>
        {h && (
          <div className="chart-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
            <div className="muted">{new Date(h.at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</div>
            <strong>{format(Number(h[value] ?? 0))}</strong>{names ? " " + names[0].toLowerCase() : ""}
            {area && <div>{format(Number(h[area] ?? 0))} {names?.[1].toLowerCase()}</div>}
          </div>
        )}
      </div>
    </section>
  );
}

/** Horizontal bars for a categorical breakdown, largest first, with value and share. */
function Bars({ title, rows, empty = "Nothing yet." }: { title: string; rows?: Count[]; empty?: string }) {
  const total = (rows ?? []).reduce((s, r) => s + Number(r.count), 0);
  const top = Math.max(1, ...(rows ?? []).map((r) => Number(r.count)));
  return (
    <section className="card stack">
      <h3 style={{ margin: 0 }}>{title}</h3>
      {!rows?.length ? <span className="small muted">{empty}</span> : rows.slice(0, 10).map((r) => (
        <div key={r.key} className="bar-row" title={`${label(r.key)}: ${n(r.count)} (${Math.round((Number(r.count) / total) * 100)}%)`}>
          <span className="small">{label(r.key)}</span>
          <div className="bar-track"><div style={{ width: (Number(r.count) / top) * 100 + "%" }} /></div>
          <span className="small mono">{n(r.count)}{r.accepted != null ? <span className="muted"> · {n(r.accepted)} AC</span> : null}</span>
        </div>
      ))}
    </section>
  );
}

function Gauge({ title, value, max, text, hint }: { title: string; value: number; max: number; text: string; hint?: string }) {
  return (
    <div className="stack" style={{ gap: "0.3rem" }}>
      <div className="row-between small"><strong>{title}</strong><span>{text}</span></div>
      <Meter value={value} max={max} />
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

function Live() {
  const o = useData<any>("/api/admin/analytics/overview", 10000);
  if (o.error && !o.data) return <ErrorBox error={o.error} />;
  if (!o.data) return <Loading />;
  const { server: s, database: d, users: u, submissions: sub, judging: j, workers, content: c } = o.data;
  const queue = Object.fromEntries((j.queue as { status: string; count: number; oldest: string }[]).map((q) => [q.status, q]));
  const waiting = (queue.QUEUED?.count ?? 0) + (queue.RETRY?.count ?? 0);
  const online = workers.filter((w: any) => w.online);
  const slots = online.reduce((t: number, w: any) => t + Number(w.slots ?? 0), 0);
  const active = online.reduce((t: number, w: any) => t + Number(w.active ?? 0), 0);
  const memRatio = s.memoryTotalMb ? s.memoryUsedMb / s.memoryTotalMb : null;
  const diskRatio = s.diskTotalMb ? 1 - s.diskFreeMb / s.diskTotalMb : null;
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="stat-tiles">
        <Stat label="Server CPU" value={pct(s.systemCpu)} hint={`API process ${pct(s.processCpu)} · ${s.cpus} cores`} tone={tone(s.systemCpu)} />
        <Stat label="Memory" value={pct(memRatio)} hint={`${mb(s.memoryUsedMb)} of ${mb(s.memoryTotalMb)}`} tone={tone(memRatio, 0.8, 0.92)} />
        <Stat label="Judge queue" value={n(waiting)} hint={queue.QUEUED?.oldest ? "oldest " + ago(queue.QUEUED.oldest) : "nothing waiting"} tone={waiting > 50 ? "bad" : waiting > 10 ? "warn" : "ok"} />
        <Stat label="Judges online" value={`${online.length}/${workers.length}`} hint={`${active}/${slots} slots busy`} tone={online.length < workers.length ? "bad" : "ok"} />
        <Stat label="Submissions / min" value={n(sub.minute)} hint={`${n(sub.hour)} last hour`} />
        <Stat label="Online users" value={n(u.online_hour)} hint={`${n(u.signed_in_day)} signed in today`} />
      </div>

      <div className="grid grid-2">
        <section className="card stack">
          <div className="row-between"><h3 style={{ margin: 0 }}>API server</h3><span className="small muted mono">{s.host}</span></div>
          <Gauge title="CPU (whole host / container)" value={s.systemCpu ?? 0} max={1} text={pct(s.systemCpu)} hint={s.loadAverage != null ? `Load average ${s.loadAverage.toFixed(2)}` : undefined} />
          <Gauge title="Memory" value={s.memoryUsedMb ?? 0} max={s.memoryTotalMb ?? 1} text={`${mb(s.memoryUsedMb)} / ${mb(s.memoryTotalMb)}`} hint={s.swapTotalMb ? `Swap ${mb(s.swapUsedMb)} / ${mb(s.swapTotalMb)}` : undefined} />
          <Gauge title="JVM heap" value={s.heapUsedMb} max={s.heapMaxMb} text={`${mb(s.heapUsedMb)} / ${mb(s.heapMaxMb)}`} hint={`${n(s.gcCount)} GCs, ${ms(s.gcMillis)} total pause`} />
          <Gauge title="Disk" value={(s.diskTotalMb ?? 0) - (s.diskFreeMb ?? 0)} max={s.diskTotalMb ?? 1} text={`${mb(s.diskFreeMb)} free`} hint={diskRatio != null ? pct(diskRatio) + " used" : undefined} />
          {s.pool && <Gauge title="Database pool" value={s.pool.active} max={s.pool.max} text={`${s.pool.active} active / ${s.pool.max}`} hint={s.pool.waiting ? `${s.pool.waiting} requests waiting for a connection` : `${s.pool.idle} idle`} />}
          <span className="small muted">Up {duration(s.uptimeSeconds)} · {s.threads} threads · Java {s.javaVersion}</span>
        </section>

        <section className="card stack">
          <h3 style={{ margin: 0 }}>Database</h3>
          <div className="capacity-numbers">
            <Stat label="Size" value={mb(d.sizeMb)} />
            <Stat label="Connections" value={(d.connections as Count[]).reduce((t: number, r: any) => t + Number(r.count), 0)} hint={`max ${d.maxConnections}`} />
            <Stat label="Cache hits" value={pct(d.cacheHitRatio)} tone={tone(d.cacheHitRatio == null ? null : 1 - d.cacheHitRatio, 0.05, 0.1)} />
          </div>
          <div className="table-wrap"><table><thead><tr><th>Largest tables</th><th>Rows</th><th>Size</th></tr></thead>
            <tbody>{d.tables.map((t: any) => <tr key={t.name}><td className="small mono">{t.name}</td><td className="small">{n(t.rows)}</td><td className="small">{mb(t.size_kb / 1024)}</td></tr>)}</tbody></table></div>
        </section>
      </div>

      <div className="grid grid-2">
        <section className="card stack">
          <h3 style={{ margin: 0 }}>Judging speed</h3>
          <div className="table-wrap"><table><thead><tr><th></th><th>Judged</th><th>Wait avg / p95</th><th>Total avg / p95</th><th>Failed</th></tr></thead>
            <tbody>{(["hour", "day"] as const).map((k) => <tr key={k}><td className="small"><strong>Last {k}</strong></td><td className="small">{n(j[k].judged)}</td>
              <td className="small">{ms(j[k].avg_wait_ms)} / {ms(j[k].p95_wait_ms)}</td><td className="small">{ms(j[k].avg_turnaround_ms)} / {ms(j[k].p95_turnaround_ms)}</td>
              <td className="small">{j[k].failed_jobs ? <Badge tone="bad">{j[k].failed_jobs}</Badge> : 0}</td></tr>)}</tbody></table></div>
          <span className="small muted">Wait = submitted until a judge picked it up. Total = submitted until verdict. {j.unpublishedEvents ? `${j.unpublishedEvents} judge messages not yet delivered.` : ""}</span>
        </section>
        <section className="card stack">
          <h3 style={{ margin: 0 }}>Platform</h3>
          <div className="capacity-numbers">
            <Stat label="Users" value={n(u.total)} hint={`+${n(u.new_day)} today · +${n(u.new_week)} this week`} />
            <Stat label="Submitting" value={n(u.submitting_day)} hint={`${n(u.submitting_week)} this week`} />
            <Stat label="Submissions" value={n(sub.total)} hint={`${n(sub.day)} today · ${n(sub.week)} this week`} />
            <Stat label="Problems" value={n(c.problems)} hint={`${n(c.practice_problems)} in practice`} />
            <Stat label="Contests" value={n(c.competitions)} hint={`${n(c.running_runs)} running now`} />
            <Stat label="Teams" value={n(c.teams)} />
          </div>
        </section>
      </div>

      <section className="card stack">
        <h3 style={{ margin: 0 }}>Judge workers</h3>
        {!workers.length ? <Empty>No judge has registered yet.</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Worker</th><th>Lane</th><th>State</th><th>Busy</th><th>Host</th><th>Judged 1h / 24h</th><th>Heartbeat</th></tr></thead>
            <tbody>{workers.map((w: any) => (
              <tr key={w.id}>
                <td className="small mono">{w.name}</td><td className="small">{w.lane}</td>
                <td>{w.online ? (w.drain_requested ? <Badge tone="warn">Draining</Badge> : <Badge tone="ok">Online</Badge>) : <Badge tone="bad">Offline</Badge>}</td>
                <td className="small" style={{ minWidth: 120 }}><Meter value={Number(w.active)} max={Number(w.slots) || 1} /> {w.active}/{w.slots}</td>
                <td className="small">{w.detected_cpus ?? "?"} CPU · {mb(w.detected_memory_mb)}</td>
                <td className="small">{n(w.judged_hour)} / {n(w.judged_day)}</td>
                <td className="small">{ago(w.last_heartbeat_at)}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </section>

      <div className="grid grid-2">
        <Bars title="Verdicts (24h)" rows={o.data.verdicts} />
        <Bars title="Languages (7 days)" rows={o.data.languages} />
        <Bars title="Where submissions come from (7 days)" rows={o.data.contexts} />
      </div>
      <span className="small muted">Refreshes every 10 seconds · generated {when(o.data.generatedAt)}</span>
    </div>
  );
}

function History() {
  const [hours, setHours] = useState(24);
  const t = useData<any>("/api/admin/analytics/timeseries?hours=" + hours, 60000);
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="row">
        {[[1, "1 hour"], [6, "6 hours"], [24, "24 hours"], [72, "3 days"], [168, "7 days"], [336, "14 days"]].map(([h, l]) =>
          <button key={h} className={"small" + (hours === h ? " primary" : "")} onClick={() => setHours(h as number)}>{l}</button>)}
      </div>
      {t.error && <ErrorBox error={t.error} />}
      {!t.data ? <Loading /> : (
        <>
          <span className="small muted">Server load is sampled every minute and kept 14 days; each point is {t.data.bucketMinutes} min.</span>
          <TimeChart title="Submissions" rows={t.data.activity} value="submissions" area="accepted" names={["Submitted", "Accepted"]} />
          <div className="grid grid-2">
            <TimeChart title="Server CPU" rows={t.data.server} value="system_cpu" format={pct} max={1} />
            <TimeChart title="Memory used" rows={t.data.server} value="memory_used_mb" format={mb} max={Math.max(1, ...t.data.server.map((r: any) => Number(r.memory_total_mb ?? 0)))} />
            <TimeChart title="Jobs waiting for a judge (peak)" rows={t.data.server} value="queued_jobs" />
            <TimeChart title="Jobs being judged (peak)" rows={t.data.server} value="running_jobs" />
            <TimeChart title="JVM heap" rows={t.data.server} value="heap_used_mb" format={mb} />
            <TimeChart title="Database connections" rows={t.data.server} value="db_connections" />
          </div>
        </>
      )}
    </div>
  );
}

function Daily() {
  const d = useData<{ today: any; reports: any[] }>("/api/admin/analytics/daily?days=60", 60000);
  if (d.error && !d.data) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  const days = [{ ...d.data.today, partial: true }, ...d.data.reports];
  const chart = [...d.data.reports].reverse().map((r) => ({ ...r, at: r.day + "T00:00:00Z" }));
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <span className="small muted">A report is written for every UTC day shortly after midnight (00:05 UTC). Missed days are filled in when the server starts.</span>
      {chart.length > 1 && <div className="grid grid-2">
        <TimeChart title="Submissions per day" rows={chart} value="submissions" area="contest_submissions" names={["All", "Contest"]} />
        <TimeChart title="Active users per day" rows={chart} value="active_users" />
        <TimeChart title="Peak CPU per day" rows={chart} value="peak_cpu" format={pct} max={1} />
        <TimeChart title="p95 time to verdict" rows={chart} value="p95_turnaround_ms" format={ms} />
      </div>}
      <section className="card stack">
        <div className="table-wrap"><table>
          <thead><tr><th>Day (UTC)</th><th>Submissions</th><th>Active users</th><th>New users</th><th>Judged</th><th>Verdict p95</th><th>Peak queue</th><th>Peak CPU</th><th>Peak memory</th><th>Busiest hour</th><th>Contests</th></tr></thead>
          <tbody>{days.map((r) => (
            <tr key={r.day}>
              <td className="small"><strong>{r.day}</strong> {r.partial && <Badge tone="info">so far</Badge>}</td>
              <td className="small">{n(r.submissions)} <span className="muted">({n(r.contest_submissions)} contest)</span></td>
              <td className="small">{n(r.active_users)}</td><td className="small">{n(r.new_users)}</td>
              <td className="small">{n(r.judged)}{r.failed_jobs ? <> · <Badge tone="bad">{r.failed_jobs} failed</Badge></> : null}</td>
              <td className="small">{ms(r.p95_turnaround_ms)}</td><td className="small">{n(r.peak_queue)}</td>
              <td className="small">{pct(r.peak_cpu)}</td><td className="small">{mb(r.peak_memory_mb)}</td>
              <td className="small">{r.busiest_hour ? `${String(r.busiest_hour.hour).padStart(2, "0")}:00 (${r.busiest_hour.count})` : "—"}</td>
              <td className="small">{n(r.contest_runs)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </div>
  );
}

function RunDetail({ id }: { id: string }) {
  const r = useData<any>("/api/manage/analytics/runs/" + id, 15000);
  if (r.error && !r.data) return <ErrorBox error={r.error} />;
  if (!r.data) return <Loading />;
  const { run, totals: t, problems, load, clarifications: q } = r.data;
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="row-between">
        <div><h2 style={{ margin: 0 }}>{run.title}</h2><span className="small muted">{when(run.startsAt)} → {when(run.endsAt)}</span></div>
        <div className="row">{run.kind === "REHEARSAL" && <Badge tone="warn">Rehearsal</Badge>}<Badge tone={run.status === "RUNNING" ? "ok" : "neutral"}>{run.status}</Badge>
          <a className="btn small" href={"#/admin/contests/" + run.competitionId}>Open contest</a></div>
      </div>
      <div className="stat-tiles">
        <Stat label="Entrants" value={n(t.entries)} hint={`${n(t.active_entries)} submitted at least once`} />
        <Stat label="Submissions" value={n(t.submissions)} hint={`${n(t.pending)} still judging`} />
        <Stat label="Accepted" value={t.submissions ? pct(t.accepted / t.submissions) : "—"} hint={`${n(t.solves)} problems solved`} />
        <Stat label="Verdict time p95" value={ms(t.p95_turnaround_ms)} hint={`avg ${ms(t.avg_turnaround_ms)} · wait p95 ${ms(t.p95_wait_ms)}`} tone={t.p95_turnaround_ms > 30000 ? "warn" : undefined} />
        <Stat label="Questions" value={n(q.total)} hint={`${n(q.answered)} answered${q.avg_answer_seconds != null ? " · avg " + duration(Number(q.avg_answer_seconds)) : ""}`} tone={q.total > q.answered ? "warn" : undefined} />
        <Stat label="Peak server CPU" value={pct(load.peak_cpu)} hint={`peak queue ${n(load.peak_queue)} · ${n(load.peak_submissions_per_minute)}/min`} tone={tone(load.peak_cpu)} />
      </div>
      <TimeChart title={`Submissions every ${Math.round(r.data.bucketSeconds / 60)} min`} rows={r.data.timeline} value="submissions" area="accepted" names={["Submitted", "Accepted"]} />
      <section className="card stack">
        <h3 style={{ margin: 0 }}>Problems</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Problem</th><th>Solved</th><th>Tried</th><th>Attempts</th><th>Solve rate</th><th>First solve</th><th>Avg AC run time</th></tr></thead>
          <tbody>{problems.map((p: any) => (
            <tr key={p.slot}>
              <td><strong>{p.label}</strong></td><td className="small">{p.title}</td>
              <td className="small">{n(p.solved)}</td><td className="small">{n(p.tried)}</td><td className="small">{n(p.attempts)}</td>
              <td className="small" style={{ minWidth: 120 }}><Meter value={Number(p.solved)} max={Number(t.entries) || 1} /> {t.entries ? pct(p.solved / t.entries) : "—"}</td>
              <td className="small">{p.first_solve_minute != null ? p.first_solve_minute + " min" : "—"}</td>
              <td className="small">{ms(p.avg_accepted_ms)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <div className="grid grid-2">
        <Bars title="Verdicts" rows={r.data.verdicts} />
        <Bars title="Languages" rows={r.data.languages} />
      </div>
    </div>
  );
}

function Contests() {
  const list = useData<any[]>("/api/manage/analytics/contests", 30000);
  const [selected, setSelected] = useState<string | null>(null);
  if (list.error && !list.data) return <ErrorBox error={list.error} />;
  if (!list.data) return <Loading />;
  if (!list.data.length) return <Empty>No contest has been run yet.</Empty>;
  const current = selected ?? list.data.find((r) => r.run_status === "RUNNING")?.run_id ?? list.data[0].run_id;
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <label className="field" style={{ maxWidth: 520 }}><span>Contest run</span>
        <select value={current} onChange={(e) => setSelected(e.target.value)}>
          {list.data.map((r) => <option key={r.run_id} value={r.run_id}>{r.title} — {r.kind === "REHEARSAL" ? "rehearsal" : "official"}, {new Date(r.starts_at).toLocaleDateString()} ({r.entries} entrants, {r.submissions} submissions)</option>)}
        </select>
      </label>
      <RunDetail key={current} id={current} />
    </div>
  );
}

export default function Analytics() {
  const { superAdmin } = useAuth();
  const tabs = superAdmin ? [["live", "Live"], ["history", "History"], ["daily", "Daily reports"], ["contests", "Contests"]] : [["contests", "Contests"]];
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Control room</div><h1>Analytics</h1><p>Server resources, judging performance, platform activity and contest statistics.</p></div>
      </div>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "live" && <Live />}
      {tab === "history" && <History />}
      {tab === "daily" && <Daily />}
      {tab === "contests" && <Contests />}
    </div>
  );
}
