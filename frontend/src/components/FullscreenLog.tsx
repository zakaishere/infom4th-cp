import { useState } from "react";
import { download } from "../api";
import { useAction, useData } from "../app";
import { Badge, Empty, Loading, Stat, timeOf } from "../ui";

export type FullscreenPerson = {
  handle: string; display_name: string; entry_name: string; is_team: boolean; left_count: number; focus_count: number; refused_count: number; reload_count: number;
  total_away_ms: number; longest_away_ms: number; last_left_at: string; away_now: boolean;
};
type FullscreenEvent = {
  id: string; kind: string; reason: string; left_at: string; returned_at: string | null; still_away: boolean; away_ms: number; handle: string; entry_name: string; is_team: boolean; next_submission_seconds: number | null;
};
export type FullscreenData = { people: FullscreenPerson[]; events: FullscreenEvent[]; entrants: number; total: number };
export type FullscreenAlert = { count: number; latest: { id: string; kind: string; reason: string; left_at: string; returned_at: string | null; handle: string; entry_name: string; is_team: boolean; competition_id: string; title: string; run_kind: string }[]; serverTime: string };

const BRIEF_MS = 5000, LONG_MS = 30000;
export const WHAT: Record<string, string> = { LEFT_FULLSCREEN: "Left full screen", LOST_FOCUS: "Used another window", FULLSCREEN_REFUSED: "Browser refused full screen" };
const CAUSE: Record<string, string> = { PAGE_RELOAD: "Page reload or closed tab", EXIT_BUTTON: "Exit button" };

export function away(ms: number) {
  if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** A first impression of how long someone was gone, for the jury to look at. Length alone proves nothing. */
function Length({ ms, still }: { ms: number; still?: boolean }) {
  if (still) return <Badge tone="bad">Away now</Badge>;
  if (ms < BRIEF_MS) return <Badge>Brief</Badge>;
  if (ms < LONG_MS) return <Badge tone="warn">Noticeable</Badge>;
  return <Badge tone="bad">Long</Badge>;
}

export function FullscreenPanel({ runId, ended, data }: { runId: string; ended: boolean; data?: FullscreenData }) {
  const { busy, run } = useAction();
  if (!data) return <Loading />;
  const awayNow = data.people.filter((p) => p.away_now);
  const left = data.people.reduce((sum, p) => sum + Number(p.left_count), 0);
  return (
    <div className="stack">
      <div className="row-between">
        <p className="small muted" style={{ margin: 0, maxWidth: 680 }}>Reported by each contestant's browser, so someone determined can block it, and a clean record proves nothing. Use it as a reason to look closer, not as proof: a person should decide.</p>
        <button className="small" disabled={busy || data.total === 0} onClick={() => run(() => download(`/api/manage/runs/${runId}/fullscreen/report.xlsx`, `fullscreen-${runId.slice(0, 8)}.xlsx`))}>Download Excel</button>
      </div>
      <div className="grid fullscreen-stats">
        <Stat label="Times left full screen" value={left} />
        <Stat label="People involved" value={data.people.length} hint={`of ${data.entrants} contestants`} />
        <Stat label="Away right now" value={ended ? "–" : awayNow.length} tone={!ended && awayNow.length ? "bad" : undefined} />
      </div>
      {data.people.length === 0 ? <Empty>Nobody has left the contest screen.</Empty> : (
        <>
          <h3 style={{ margin: 0 }}>By player</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Player</th><th>Team</th><th className="right">Left</th><th className="right">Other window</th><th className="right">Reloads</th><th className="right">Total away</th><th className="right">Longest</th><th>Last left</th></tr></thead>
              <tbody>{data.people.map((p) => (
                <tr key={p.handle} className={p.away_now ? "fullscreen-away" : ""}>
                  <td><strong>@{p.handle}</strong>{p.away_now && <> <Badge tone="bad">Away now</Badge></>}<div className="small muted">{p.display_name}</div></td>
                  <td className="small">{p.is_team ? p.entry_name : "–"}</td>
                  <td className="right mono">{p.left_count}</td><td className="right mono">{p.focus_count}</td><td className="right mono">{p.reload_count}</td>
                  <td className="right mono">{away(Number(p.total_away_ms))}</td><td className="right mono">{away(Number(p.longest_away_ms))}</td>
                  <td className="small">{timeOf(p.last_left_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <h3 style={{ margin: 0 }}>Every event{data.total > data.events.length ? ` (newest ${data.events.length} of ${data.total})` : ""}</h3>
          <div className="table-wrap fullscreen-events">
            <table>
              <thead><tr><th>Left at</th><th>Back at</th><th className="right">Away</th><th>Length</th><th>Player</th><th>Team</th><th>What happened</th><th className="right" title="How soon this contestant's next submission came after returning. A quick submission after a long absence may be worth a look.">Next submission</th></tr></thead>
              <tbody>{data.events.map((e) => (
                <tr key={e.id}>
                  <td className="small mono">{timeOf(e.left_at)}</td>
                  <td className="small mono">{e.returned_at ? timeOf(e.returned_at) : e.still_away && !ended ? "–" : "Never"}</td>
                  <td className="right mono">{away(Number(e.away_ms))}</td>
                  <td><Length ms={Number(e.away_ms)} still={e.still_away && !ended} /></td>
                  <td className="small">@{e.handle}</td><td className="small">{e.is_team ? e.entry_name : "–"}</td>
                  <td className="small">{CAUSE[e.reason] ?? WHAT[e.kind] ?? e.kind}</td>
                  <td className="right small mono">{e.next_submission_seconds == null ? "–" : e.next_submission_seconds < 60 ? e.next_submission_seconds + " s" : Math.round(e.next_submission_seconds / 60) + " min"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const SEEN_KEY = "cp.fullscreen.alerts.seen";
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };

/** The control room's warning: red and shaking until an organizer has looked at it. */
export function useFullscreenAlerts(enabled: boolean) {
  const [seen, setSeen] = useState(readSeen);
  const alerts = useData<FullscreenAlert>(enabled ? "/api/manage/fullscreen/alerts" + (seen ? "?after=" + encodeURIComponent(seen) : "") : null, 5000);
  const dismiss = () => {
    const now = alerts.data?.serverTime ?? new Date().toISOString();
    try { localStorage.setItem(SEEN_KEY, now); } catch { /* it just stays for this session */ }
    setSeen(now);
    alerts.setData(undefined);
  };
  return { data: alerts.data, error: alerts.error, dismiss };
}

export function FullscreenAlertBanner({ alert, onDismiss }: { alert: FullscreenAlert; onDismiss: () => void }) {
  const latest = alert.latest[0];
  if (!latest) return null;
  return (
    <div className="fullscreen-alert" role="alert">
      <div style={{ minWidth: 0 }}>
        <strong>⚠ {alert.count} full screen warning{alert.count === 1 ? "" : "s"}</strong>
        <ul>
          {alert.latest.slice(0, 3).map((a) => (
            <li key={a.id}>
              <strong>@{a.handle}</strong>{a.is_team ? ` (${a.entry_name})` : ""}: {CAUSE[a.reason] ?? WHAT[a.kind] ?? a.kind} at {timeOf(a.left_at)}{a.returned_at ? ", now back" : ", still away"}
              <span className="fullscreen-alert-contest"> · {a.title}{a.run_kind === "REHEARSAL" ? " (rehearsal)" : ""}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="row" style={{ flexWrap: "nowrap", flex: "none" }}>
        <a className="btn small" href={`#/admin/contests/${latest.competition_id}?tab=fullscreen`}>View log</a>
        <button className="small" onClick={onDismiss}>Mark as seen</button>
      </div>
    </div>
  );
}
