import { useEffect, useState } from "react";
import { useAuth, useData } from "../../app";
import { Badge, Empty, ErrorBox, LANGUAGE_NAMES, Loading, Meter, Stat, VERDICTS, Verdict, ago, timeOf, when } from "../../ui";

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
  const xt = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - 4);
  const x = (i: number) => xt(new Date(rows[i].at).getTime());
  // A range with fewer samples than its bucket size leaves holes. A missing API sample means the
  // server said nothing at all; drawing straight through it would look like calm instead of an outage.
  const times = rows.map((r) => new Date(r.at).getTime());
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0).sort((a, b) => a - b);
  const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const holes = typical > 0 ? times.slice(1).map((t, i) => ({ from: times[i], to: t })).filter((h) => h.to - h.from > typical * 2.2) : [];
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
          {holes.map((h, i) => {
            const width = Math.max(1, xt(h.to) - xt(h.from));
            return <g key={"gap" + i}>
              <rect x={xt(h.from)} y={T} width={width} height={H - T - B} className="chart-gap" />
              {width > 46 && <text x={xt(h.from) + width / 2} y={T + 12} textAnchor="middle" className="chart-gap-label">no data</text>}
            </g>;
          })}
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

function ApiCalls() {
  const [minutes, setMinutes] = useState(10);
  const a = useData<any>("/api/admin/analytics/api?minutes=" + minutes, 5000);
  const buckets = a.data?.buckets ?? [];
  const now = a.data?.now;
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="row">
        {[[1, "1 min"], [5, "5 min"], [10, "10 min"], [15, "15 min"], [60, "1 hour"], [360, "6 hours"], [1440, "24 hours"]].map(([m, l]) =>
          <button key={m} className={"small" + (minutes === m ? " primary" : "")} onClick={() => setMinutes(m as number)}>{l}</button>)}
      </div>
      {a.error && <ErrorBox error={a.error} />}
      {!a.data ? <Loading /> : (
        <>
          <span className="small muted">Last {a.data.windowMinutes} minutes, {a.data.bucketSeconds} s per point, {a.data.source === "live" ? "read from the live meter (covers the last 15 minutes)" : "read from the saved per-minute totals"}. Includes rejected requests that never reach the database. Refreshes every 5 seconds.</span>
          <div className="stat-tiles">
            <Stat label="Requests" value={n(now?.requests)} hint={`peak ${n(a.data.peakRps)}/s in this window`} />
            <Stat label="4xx rejected" value={n(now?.clientErrors)} hint="429 admission, 401 auth, 403 permission" tone={now?.clientErrors > 0 ? "warn" : "ok"} />
            <Stat label="5xx errors" value={n(now?.serverErrors)} hint="the API itself failed" tone={now?.serverErrors > 0 ? "bad" : "ok"} />
            <Stat label="Average response" value={ms(now?.avgMs)} hint={`slowest ${ms(now?.maxMs)}`} />
          </div>
          <TimeChart title="Requests per second" rows={buckets} value="rps" format={(v) => Number(v).toFixed(2)} />
          <div className="grid grid-2">
            <TimeChart title="Rejected requests (4xx)" rows={buckets} value="clientErrors" />
            <TimeChart title="Server errors (5xx)" rows={buckets} value="serverErrors" />
          </div>
          <section className="card stack">
            <h3 style={{ margin: 0 }}>Endpoints in this window</h3>
            {!a.data.endpoints?.length ? <span className="small muted">{a.data.source === "stored" ? "Per-endpoint detail is kept in the live meter only (last 15 minutes); this range shows totals." : "No requests recorded yet."}</span> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Endpoint</th><th>Requests</th><th>4xx</th><th>5xx</th><th>Average</th><th>Slowest</th></tr></thead>
                <tbody>{a.data.endpoints.map((e: any) => (
                  <tr key={e.path}>
                    <td className="small mono">{e.path}</td>
                    <td className="small">{n(e.requests)}</td>
                    <td className="small" style={{ color: e.clientErrors ? "var(--warn)" : undefined }}>{n(e.clientErrors)}</td>
                    <td className="small" style={{ color: e.serverErrors ? "var(--bad)" : undefined }}>{n(e.serverErrors)}</td>
                    <td className="small mono">{ms(e.avgMs)}</td>
                    <td className="small mono">{ms(e.maxMs)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const HISTORY_RANGES: [number, string][] = [[10, "10 min"], [60, "1 hour"], [360, "6 hours"], [1440, "24 hours"], [10080, "7 days"], [20160, "14 days"]];

function History() {
  const [minutes, setMinutes] = useState(1440);
  // Short contest windows need fresh points; long history does not.
  const t = useData<any>("/api/admin/analytics/timeseries?minutes=" + minutes, minutes <= 60 ? 10000 : 60000);
  const bucket = t.data ? (t.data.bucketSeconds < 60 ? t.data.bucketSeconds + " s" : Math.round(t.data.bucketSeconds / 60) + " min") : "";
  const rate = (v: Num) => Number(v).toFixed(2);
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="row">
        {HISTORY_RANGES.map(([m, l]) =>
          <button key={m} className={"small" + (minutes === m ? " primary" : "")} onClick={() => setMinutes(m)}>{l}</button>)}
      </div>
      {t.error && <ErrorBox error={t.error} />}
      {!t.data ? <Loading /> : (
        <>
          <span className="small muted">Pipeline numbers are counted per bucket, {bucket} each. Host metrics are sampled every minute, so short ranges show one point per sample.</span>
          <TimeChart title="Arrivals vs claims per minute" rows={t.data.activity} value="arrivals_per_min" area="claims_per_min" names={["Arrived", "Claimed"]} format={rate} />
          <div className="grid grid-2">
            <TimeChart title="Judge queue backlog" rows={t.data.activity} value="backlog" />
            <TimeChart title="Retries vs dropped jobs per minute" rows={t.data.activity} value="retries_per_min" area="dropped_per_min" names={["Retried", "Dropped"]} format={rate} />
          </div>
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

type TimedRow = {
  id: string; submitted_at: string; kind: string; language_code: string; handle: string; problem: string; contest: string | null; label: string | null; samples_only: boolean;
  status: string | null; verdict: string | null; passed_tests: number | null; total_tests: number | null; execution_time_ms: number | null; peak_memory_kb: number | null;
  generation: number | null; attempt_count: number | null; last_error_code: string | null; worker: string | null; wait_ms: number | null; judge_ms: number | null; server_ms: number | null;
  compile_ms: number | null; tests_ms: number | null; sandbox_ms: number | null; accepted_ms: number | null; verdict_ms: number | null;
};
const KINDS = ["Contest", "Practice", "Practice examples", "Problem testing"];
const RANGES: [number, string][] = [[1, "1 hour"], [6, "6 hours"], [24, "24 hours"], [168, "7 days"], [720, "30 days"]];

function Range({ hours, setHours }: { hours: number; setHours: (h: number) => void }) {
  return <div className="row">{RANGES.map(([h, l]) => <button key={h} className={"small" + (hours === h ? " primary" : "")} onClick={() => setHours(h)}>{l}</button>)}</div>;
}

function LatencyTable({ title, first, rows, name }: { title: string; first: string; rows?: any[]; name: (r: any) => string }) {
  return (
    <section className="card stack">
      <h3 style={{ margin: 0 }}>{title}</h3>
      {!rows?.length ? <span className="small muted">No finished submissions in this range.</span> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{first}</th><th>Count</th><th>Accepted by server</th><th>Wait for judge</th><th>Judging</th><th>Verdict on screen</th><th>Compile</th><th>Tests</th><th>Sandbox</th><th>Retries</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={name(r)}>
              <td className="small"><strong>{name(r)}</strong></td><td className="small">{n(r.count)}</td>
              {["accepted_ms", "wait_ms", "judge_ms", "verdict_ms"].map((c) => <td key={c} className="small mono">{ms(r["avg_" + c])}<div className="muted">p95 {ms(r["p95_" + c])}</div></td>)}
              <td className="small mono">{ms(r.avg_compile_ms)}</td><td className="small mono">{ms(r.avg_tests_ms)}</td><td className="small mono">{ms(r.avg_sandbox_ms)}</td>
              <td className="small mono" title={`${r.avg_attempts ?? 1} attempts per job on average, worst ${r.worst_attempts ?? 1}`}>
                {r.retried ? <strong>{n(r.retried)}</strong> : "0"}{r.retried ? <div className="muted">of {n(r.count)}</div> : null}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Submissions() {
  const [hours, setHours] = useState(24);
  const [kind, setKind] = useState("");
  const [verdict, setVerdict] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [slowest, setSlowest] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const params = new URLSearchParams({ hours: String(hours), slowest: String(slowest) });
  if (kind) params.set("kind", kind); if (verdict) params.set("verdict", verdict); if (q) params.set("q", q);
  const rows = useData<TimedRow[]>("/api/admin/analytics/submissions?" + params, 10000);
  const stats = useData<any>("/api/admin/analytics/latency?hours=" + hours, 30000);
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <Range hours={hours} setHours={setHours} />
      <p className="small muted" style={{ margin: 0 }}>
        <strong>Accepted by server</strong>: click until the server confirmed it. <strong>Wait for judge</strong>: queued until a judge took it. <strong>Judging</strong>: judge start to verdict.
        <strong> Verdict on screen</strong>: click until the user saw the result, measured in their browser, including up to 2 seconds of page refresh.
        Browser numbers and the compile, tests and sandbox split only exist for submissions made after this update, and only while the tab stayed open.
      </p>
      <LatencyTable title="Average latency by type" first="Type" rows={stats.data?.byKind} name={(r) => r.kind} />
      <LatencyTable title="Average latency by language" first="Language" rows={stats.data?.byLanguage} name={(r) => LANGUAGE_NAMES[r.language_code] ?? r.language_code} />
      <section className="card stack">
        <h3 style={{ margin: 0 }}>Jobs the platform dropped</h3>
        {stats.data?.failures && Number(stats.data.failures.total) > 0 ? (
          <>
            <div className="small muted">
              {n(stats.data.failures.total)} job(s) used every attempt without producing a verdict. Time is from submission to giving up, retries included.
            </div>
            <div className="table-wrap"><table>
              <thead><tr><th>Reason</th><th>Count</th><th>Average</th><th>p95</th><th>Worst</th></tr></thead>
              <tbody>{(stats.data.failureCodes ?? []).map((f: any) => (
                <tr key={f.code}>
                  <td className="small mono"><strong>{f.code}</strong></td>
                  <td className="small">{n(f.count)}</td>
                  <td className="small mono">{ms(f.avg_server_ms)}</td>
                  <td className="small mono">{ms(f.p95_server_ms)}</td>
                  <td className="small mono">{ms(f.max_server_ms)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        ) : <span className="small muted">No job has exhausted its attempts in this range.</span>}
      </section>
      <section className="card stack">
        <div className="row-between"><h3 style={{ margin: 0 }}>Recent submissions</h3>
          <div className="row" style={{ alignItems: "center" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="User, problem or contest" style={{ width: 200 }} />
            <select value={kind} aria-label="Type" onChange={(e) => setKind(e.target.value)}><option value="">All types</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <select value={verdict} aria-label="Verdict" onChange={(e) => setVerdict(e.target.value)}><option value="">All verdicts</option>{Object.entries(VERDICTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            <button className={"small" + (slowest ? " primary" : "")} onClick={() => setSlowest(!slowest)}>{slowest ? "Slowest first" : "Newest first"}</button>
          </div></div>
        <ErrorBox error={rows.error} />
        {rows.loading ? <Loading /> : !rows.data?.length ? <Empty>No submission matches.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Time</th><th>User</th><th>Problem</th><th>Language</th><th>Result</th><th>Accepted</th><th>Wait</th><th>Judging</th><th>Verdict on screen</th><th>Run time</th><th>Memory</th><th>Judge</th></tr></thead>
            <tbody>{rows.data.map((s) => (
              <tr key={s.id}>
                <td className="small">{timeOf(s.submitted_at)}</td>
                <td className="small">@{s.handle}</td>
                <td className="small">{s.label ? <strong>{s.label} </strong> : null}{s.problem}<div className="muted">{s.contest ?? s.kind}</div></td>
                <td className="small">{LANGUAGE_NAMES[s.language_code] ?? s.language_code}</td>
                <td className="small"><Verdict status={s.status ?? undefined} verdict={s.verdict} />{s.total_tests ? <div className="muted mono">{s.passed_tests}/{s.total_tests} tests</div> : null}{(s.generation ?? 1) > 1 ? <div className="muted">rejudge</div> : null}{(s.attempt_count ?? 0) > 1 ? <div className="muted">×{s.attempt_count} attempts</div> : null}{s.status === "FAILED" && s.last_error_code ? <div className="muted mono">{s.last_error_code}</div> : null}</td>
                <td className="small mono">{ms(s.accepted_ms)}</td><td className="small mono">{ms(s.wait_ms)}</td>
                <td className="small mono" title={s.compile_ms != null ? `Compile ${ms(s.compile_ms)}, tests ${ms(s.tests_ms)}, sandbox ${ms(s.sandbox_ms)}` : undefined}>{ms(s.judge_ms)}</td>
                <td className="small mono"><strong>{ms(s.verdict_ms)}</strong></td>
                <td className="small mono">{ms(s.execution_time_ms)}</td>
                <td className="small mono">{s.peak_memory_kb != null ? mb(s.peak_memory_kb / 1024) : "—"}</td>
                <td className="small mono">{s.worker ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <span className="small muted">Refreshes every 10 seconds. Shows up to 100 submissions.</span>
    </div>
  );
}

function Capacity() {
  const stats = useData<any>("/api/admin/analytics/latency?hours=168", 60000);
  const [laneName, setLaneName] = useState("official");
  const [judgeSeconds, setJudgeSeconds] = useState("");
  const [gapMinutes, setGapMinutes] = useState(5);
  if (stats.error && !stats.data) return <ErrorBox error={stats.error} />;
  if (!stats.data) return <Loading />;
  const lanes: any[] = stats.data.lanes;
  const lane = lanes.find((l) => l.lane === laneName);
  const measured = lanes.flatMap((l) => (l.avg_judge_ms != null ? [{ lane: l.lane, seconds: l.avg_judge_ms / 1000, count: l.count }] : []));
  const own = measured.find((m) => m.lane === laneName);
  const fallback = own ?? measured[0];
  const seconds = Number(judgeSeconds) > 0 ? Number(judgeSeconds) : fallback?.seconds ?? 12;
  const configured = Number(lane?.slots ?? 0);
  const budget = stats.data.hostBudgetMb && stats.data.slotMemoryMb ? Math.floor(stats.data.hostBudgetMb / stats.data.slotMemoryMb) : null;
  const slots = budget != null ? Math.min(configured, budget) : configured;
  const perMinute = slots > 0 ? (slots / seconds) * 60 : 0;
  const estimate = (users: number) => {
    const rounds = Math.ceil(users / Math.max(slots, 1));
    return { last: rounds * seconds, average: ((rounds + 1) / 2) * seconds };
  };
  const clock = (s: number) => (s < 90 ? Math.round(s) + " s" : s < 5400 ? Math.round(s / 60) + " min" : (s / 3600).toFixed(1) + " h");
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="card row" style={{ alignItems: "flex-end" }}>
        <label className="field"><span>Judge</span><select value={laneName} onChange={(e) => { setLaneName(e.target.value); setJudgeSeconds(""); }}><option value="official">Contests (official)</option><option value="internal">Practice (internal)</option></select></label>
        <label className="field"><span>Seconds to judge one submission</span><input type="number" min="0.1" step="0.1" value={judgeSeconds} placeholder={seconds.toFixed(1)} onChange={(e) => setJudgeSeconds(e.target.value)} style={{ width: 150 }} /></label>
        <label className="field"><span>A user submits every (minutes)</span><input type="number" min="1" value={gapMinutes} onChange={(e) => setGapMinutes(Math.max(1, Number(e.target.value) || 1))} style={{ width: 150 }} /></label>
      </div>
      {!own && !judgeSeconds && <div className="notice warn small">No {laneName === "official" ? "contest" : "practice"} submissions were measured in the last 7 days{fallback ? `, so this uses the ${fallback.lane} average of ${fallback.seconds.toFixed(1)} s` : ", so this assumes 12 s"}. Treat it as a rough guide until you run a real test.</div>}
      {budget != null && budget < configured && <div className="notice warn small">This judge has {configured} slots, but the memory budget allows {budget} running at once across both judges. The numbers use {budget}.</div>}
      {lane && lane.cpus && configured > lane.cpus && <div className="notice warn small">{configured} slots on {lane.cpus} CPUs: submissions would compete for CPU, which slows judging and can cause false time limit verdicts.</div>}
      <div className="stat-tiles">
        <Stat label="Slots in use" value={slots} hint={`${lane?.cpus ?? "?"} CPUs · ${mb(lane?.memory_mb)}`} />
        <Stat label="Judged per minute" value={Math.round(perMinute)} hint={`${n(Math.round(perMinute * 60))} per hour at full load`} />
        <Stat label="Steady active users" value={n(Math.floor(perMinute * gapMinutes))} hint={`each submitting every ${gapMinutes} min, without a growing queue`} />
      </div>
      <section className="card stack">
        <h3 style={{ margin: 0 }}>If this many users submit at the same moment</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Users at once</th><th>Average wait for a verdict</th><th>Last user's verdict</th><th>Queue load</th></tr></thead>
          <tbody>{[slots || 1, 10, 25, 50, 100, 200, 500, 1000].filter((v, i, all) => all.indexOf(v) === i).sort((a, b) => a - b).map((users) => {
            const e = estimate(users);
            return <tr key={users}><td className="small"><strong>{n(users)}</strong></td><td className="small mono">{clock(e.average)}</td><td className="small mono">{clock(e.last)}</td>
              <td className="small" style={{ minWidth: 120 }}>{users > Number(stats.data.limits.max_queued_submissions) ? <Badge tone="bad">Over queue limit</Badge> : <Badge tone={e.last > 300 ? "bad" : e.last > 60 ? "warn" : "ok"}>{e.last > 300 ? "Slow" : e.last > 60 ? "Noticeable" : "Fine"}</Badge>}</td></tr>;
          })}</tbody>
        </table></div>
        <span className="small muted">
          Estimate: rounds = users ÷ slots, last verdict = rounds × seconds, average = (rounds + 1) ÷ 2 × seconds. It assumes every submission takes the same time and that judging is the only limit, so problems with many tests or slow languages take longer. Limits in force: {stats.data.limits.pending_submissions_per_user} pending and {stats.data.limits.submissions_per_minute} per minute per user, {n(stats.data.limits.max_queued_submissions)} queued in total.
        </span>
      </section>
    </div>
  );
}

export default function Analytics() {
  const { superAdmin } = useAuth();
  const health = useData<any>(superAdmin ? "/api/admin/analytics/overview" : null, 30000);
  const state = health.data?.health;
  const tabs = superAdmin ? [["live", "Live"], ["history", "History"], ["api", "API"], ["daily", "Daily reports"], ["submissions", "Submissions"], ["capacity", "Capacity"], ["contests", "Contests"]] : [["contests", "Contests"]];
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">Control room</div><h1>Analytics</h1><p>Server resources, judging performance, platform activity and contest statistics.</p></div>
      </div>
      {state && state.level !== "ok" && (
        <div className={"notice " + (state.level === "bad" ? "bad" : "warn")}>
          <strong>{state.level === "bad" ? "The platform is not healthy." : "Worth watching."}</strong>
          <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>{(state.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "live" && <Live />}
      {tab === "history" && <History />}
      {tab === "api" && <ApiCalls />}
      {tab === "daily" && <Daily />}
      {tab === "submissions" && <Submissions />}
      {tab === "capacity" && <Capacity />}
      {tab === "contests" && <Contests />}
    </div>
  );
}
