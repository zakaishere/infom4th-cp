import { useEffect, useRef, useState } from "react";
import { del, patch, put } from "../api";
import { useAction, useAuth, useData, useToast } from "../app";
import { ChangePassword } from "../components/Account";
import { Avatar, TierChip } from "../components/Avatar";
import { BarList, Heatmap, LineChart, SkillRadar } from "../components/Charts";
import { SCORING_INFO } from "../components/Standings";
import { drawCard, loadLogo } from "../lib/shareCard";
import { Empty, ErrorBox, Field, LANGUAGE_NAMES, Loading, Modal, Stat, VERDICTS, when } from "../ui";

type Summary = { handle: string; display_name: string; sigma: number | null; rank: number | null; tier: string | null; solved: number; rating: number | null };
export type ContestRow = {
  run_id: string; title: string; starts_at: string; scoring_system: keyof typeof SCORING_INFO; mode: string; rated: boolean;
  rank: number; entrants: number; solved: number; score: number; entry_name: string; team_id: string | null; delta?: number; members?: string;
};
type Medals = { gold: number; silver: number; bronze: number };
type Data = {
  user: { handle: string; display_name: string; bio: string; school: string; country: string | null; github: string | null; codeforces: string | null; created_at: string; staff: boolean };
  own: boolean; isRival: boolean; playerCount: number; provisional: boolean; rating: number | null;
  sigma: { rank: number; score: number; tier: string; solved: number } | null;
  stats: {
    today: string; activity: { date: string; count: number }[]; current_streak: number; best_streak: number; submissions: number; solved: number; tried: number;
    easy: number; medium: number; hard: number; verdicts: Record<string, number>; languages: { code: string; accepted: number }[];
    fastest?: { title: string; ms: number }; lightest?: { title: string; kb: number };
  };
  skills: { tag: string; solved: number; total: number }[];
  nextProblem?: { tag: string; title: string; version_id: string };
  ratingHistory: { run_id: string; title: string; at: string; rating: number; delta: number; rank: number; entrants: number }[];
  contests: ContestRow[]; medals: Medals;
  badges: { code: string; name: string; description: string; count: number }[];
  teams: { id: string; name: string }[];
  playedWith: { handle: string; display_name: string; contests: number }[];
};

const BADGE_ICON: Record<string, string> = { first_blood: "①", clean_sheet: "✓", buzzer_beater: "⏱", freeze_breaker: "❄", polyglot: "{ }", sniper: "◎" };
const flag = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const shortDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", year: "numeric" });

export function MedalRow({ medals }: { medals: Medals }) {
  return (
    <div className="medals" aria-label={`${medals.gold} gold, ${medals.silver} silver, ${medals.bronze} bronze medals`}>
      <span title="First place"><i className="gold" />{medals.gold}</span>
      <span title="Second place"><i className="silver" />{medals.silver}</span>
      <span title="Third place"><i className="bronze" />{medals.bronze}</span>
    </div>
  );
}

function EditProfile({ d, onClose, onSaved }: { d: Data; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ bio: d.user.bio, school: d.user.school, country: d.user.country ?? "", github: d.user.github ?? "", codeforces: d.user.codeforces ?? "" });
  const { busy, run } = useAction();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  return (
    <Modal title="Edit profile" onClose={onClose}>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        run(async () => { await patch("/api/me/profile", { ...form, country: form.country.toUpperCase() }); onSaved(); onClose(); }, "Profile saved");
      }}>
        <Field label="Bio" hint={`${form.bio.length} / 280`}><textarea maxLength={280} value={form.bio} onChange={set("bio")} /></Field>
        <Field label="School or club"><input maxLength={100} value={form.school} onChange={set("school")} /></Field>
        <Field label="Country" hint="Two-letter code, such as MA"><input maxLength={2} value={form.country} onChange={set("country")} style={{ width: 80, textTransform: "uppercase" }} /></Field>
        <Field label="GitHub username"><input maxLength={39} value={form.github} onChange={set("github")} /></Field>
        <Field label="Codeforces handle"><input maxLength={24} value={form.codeforces} onChange={set("codeforces")} /></Field>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function ShareCard({ d, onClose }: { d: Data; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let open = true;
    loadLogo().then((logo) => {
      if (!open) return;
      drawCard(canvas.current!, {
        handle: d.user.handle, name: d.user.display_name, tier: d.sigma?.tier, sigma: d.sigma?.score, rank: d.sigma?.rank, players: d.playerCount,
        rating: d.rating, solved: d.stats.solved, gold: Number(d.medals.gold), silver: Number(d.medals.silver), bronze: Number(d.medals.bronze),
      }, logo);
    });
    return () => { open = false; };
  }, [d]);
  return (
    <Modal title="Share card" onClose={onClose}>
      <div className="stack">
        <canvas ref={canvas} className="share-canvas" role="img" aria-label={`Stats card for ${d.user.display_name}`} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="primary" onClick={() => canvas.current!.toBlob((blob) => {
            if (!blob) return;
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob); link.download = `infom4th-${d.user.handle}.png`; link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          })}>Download image</button>
        </div>
      </div>
    </Modal>
  );
}

function Replay({ handle, contest, onClose }: { handle: string; contest: ContestRow; onClose: () => void }) {
  const replay = useData<{ rank: number; entrants: number; durationSeconds: number; seconds: number[]; ranks: number[]; solves: { seconds: number; label: string }[] }>(`/api/profiles/${handle}/contests/${contest.run_id}/replay`);
  const r = replay.data;
  const minutes = (s: number) => Math.round(s / 60) + " min";
  return (
    <Modal title={"Replay: " + contest.title} onClose={onClose}>
      <ErrorBox error={replay.error} />
      {replay.loading ? <Loading label="Rewinding the contest…" /> : r && (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>@{handle}'s place through the contest, finishing #{r.rank} of {r.entrants}. Letters mark solved problems.</p>
          <LineChart label={`Rank over time, finishing ${r.rank} of ${r.entrants}`} invert integer
            points={r.seconds.map((s, i) => ({ x: s, y: r.ranks[i], tip: <>#{r.ranks[i]} at {minutes(s)}</> }))}
            xLabels={["Start", minutes(r.durationSeconds)]} yLabel={(y) => "#" + y}
            markers={r.solves.map((m) => ({ x: m.seconds, label: m.label, tip: `${m.label} solved at ${minutes(m.seconds)}` }))} />
        </div>
      )}
    </Modal>
  );
}

function Rivals() {
  const rivals = useData<Summary[]>("/api/me/rivals");
  const { me } = useAuth();
  if (!rivals.data?.length) return null;
  return (
    <section className="card stack">
      <h3>Your rivals</h3>
      {rivals.data.map((r) => (
        <div key={r.handle} className="row-between person">
          <a href={"#/u/" + r.handle} className="row" style={{ gap: "0.6rem", minWidth: 0 }}>
            <Avatar handle={r.handle} size={30} tier={r.tier} />
            <span><strong>{r.display_name}</strong><div className="small muted">{r.sigma != null ? `Σ ${r.sigma.toLocaleString()} · #${r.rank}` : "Not ranked yet"}</div></span>
          </a>
          <a className="btn small" href={`#/u/${me?.handle}/vs/${r.handle}`}>Compare</a>
        </div>
      ))}
    </section>
  );
}

export default function Profile({ handle }: { handle: string }) {
  const { me } = useAuth();
  const toast = useToast();
  const profile = useData<Data>("/api/profiles/" + handle);
  const { busy, run } = useAction();
  const [dialog, setDialog] = useState<"edit" | "password" | "share" | null>(null);
  const [replay, setReplay] = useState<ContestRow | null>(null);
  if (profile.loading) return <main className="page"><Loading label="Loading the profile…" /></main>;
  if (!profile.data) return <main className="page"><ErrorBox error={profile.error} /></main>;
  const d = profile.data, u = d.user, s = d.stats;
  const verdicts = Object.entries(s.verdicts).map(([code, value]) => ({ label: VERDICTS[code]?.label ?? code, value })).sort((a, b) => b.value - a.value);
  const accepted = s.verdicts.ACCEPTED ?? 0, judged = Object.values(s.verdicts).reduce((sum, n) => sum + n, 0);
  const history = d.ratingHistory;
  return (
    <main className="page">
      <section className="hero profile-hero">
        <div className="profile-head">
          <Avatar handle={u.handle} size={104} tier={d.sigma?.tier} />
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ color: "#35c7e8" }}>@{u.handle}{u.country ? " " + flag(u.country) : ""}{u.staff ? " · Staff" : ""}</div>
            <h1>{u.display_name}</h1>
            <div className="row profile-tags">
              <TierChip tier={d.sigma?.tier} />
              {u.school && <span>{u.school}</span>}
              {u.github && <a href={"https://github.com/" + u.github} target="_blank" rel="noreferrer noopener">GitHub ↗</a>}
              {u.codeforces && <a href={"https://codeforces.com/profile/" + u.codeforces} target="_blank" rel="noreferrer noopener">Codeforces ↗</a>}
              <span>Joined {shortDate(u.created_at)}</span>
            </div>
            {u.bio && <p className="profile-bio">{u.bio}</p>}
          </div>
        </div>
        <div className="hero-stats">
          <div><strong className="mono">{d.sigma ? "Σ " + d.sigma.score.toLocaleString() : "–"}</strong><span>{d.sigma ? `#${d.sigma.rank} of ${d.playerCount}` : u.staff ? "Staff are not ranked" : "Not ranked yet"}</span></div>
          <div><strong className="mono">{d.rating ?? "–"}</strong><span>{d.rating == null ? "No rated contests" : d.provisional ? "Rating (provisional)" : "Rating"}</span></div>
          <div><strong>{s.solved}</strong><span>Solved</span></div>
          <div><strong>{s.current_streak}</strong><span>Day streak (best {s.best_streak})</span></div>
          <div><MedalRow medals={d.medals} /><span>Medals</span></div>
        </div>
        <div className="row profile-actions">
          {d.own ? (
            <>
              <button className="small" onClick={() => setDialog("edit")}>Edit profile</button>
              <button className="small" onClick={() => setDialog("password")}>Change password</button>
            </>
          ) : (
            <>
              <a className="btn small" href={`#/u/${me?.handle}/vs/${u.handle}`}>Compare with me</a>
              <button className="small" disabled={busy} onClick={() => run(async () => {
                await (d.isRival ? del("/api/me/rivals/" + u.handle) : put("/api/me/rivals/" + u.handle, {}));
                profile.setData({ ...d, isRival: !d.isRival });
                toast("success", d.isRival ? "Rival removed" : "Rival pinned. They now stand out on scoreboards.");
              })}>{d.isRival ? "★ Rival" : "☆ Pin as rival"}</button>
            </>
          )}
          <button className="small" onClick={() => setDialog("share")}>Share card</button>
        </div>
        <img src="/logo.png" alt="" />
      </section>

      <div className="stack" style={{ gap: "1.25rem" }}>
        <section className="card">
          <h3>Activity</h3>
          {s.submissions === 0 ? <Empty>No public activity yet.</Empty> : <Heatmap activity={s.activity} today={s.today} />}
        </section>

        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <section className="card stack">
            <h3>Rating</h3>
            {history.length === 0 ? <Empty>The rating starts after the first rated contest.</Empty> : (
              <LineChart label={`Rating over ${history.length} contests, now ${d.rating}`}
                points={history.map((p) => ({ x: new Date(p.at).getTime(), y: p.rating, tip: <><strong>{p.rating}</strong> ({p.delta >= 0 ? "+" : ""}{p.delta})<br />{p.title}<br />#{p.rank} of {p.entrants}</> }))}
                xLabels={[shortDate(history[0].at), shortDate(history[history.length - 1].at)]} />
            )}
          </section>
          <section className="card stack">
            <h3>Skills</h3>
            {d.skills.length < 3 ? <Empty>Skills appear once practice problems have tags.</Empty> : <SkillRadar skills={d.skills} />}
            {d.nextProblem && (
              <a className="notice small next-problem" href={"#/practice/" + d.nextProblem.version_id}>
                <span>Weakest tag: <strong>{d.nextProblem.tag}</strong>. Next up: {d.nextProblem.title}</span><span className="btn small primary">Train ▸</span>
              </a>
            )}
          </section>
        </div>

        <section className="card stack">
          <h3>Badges</h3>
          <div className="badge-grid">
            {d.badges.map((b) => (
              <div key={b.code} className={"trophy" + (b.count > 0 ? " earned" : "")} title={b.description}>
                <b aria-hidden>{BADGE_ICON[b.code]}</b>
                <div><strong>{b.name}</strong>{b.count > 1 && <span className="tag" style={{ marginLeft: 6 }}>×{b.count}</span>}<div className="small muted">{b.description}</div></div>
                <span className="sr-only">{b.count > 0 ? "Earned" : "Not earned yet"}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <section className="card stack">
            <h3>Solved</h3>
            <div className="grid grid-3-tight">
              <Stat label="Easy" value={s.easy} /><Stat label="Medium" value={s.medium} /><Stat label="Hard" value={s.hard} />
            </div>
            <div className="small muted">{s.tried} problems tried · {s.submissions} submissions{judged ? ` · ${Math.round((100 * accepted) / judged)}% accepted` : ""}</div>
            {s.fastest && <div className="small">Fastest run: <strong className="mono">{s.fastest.ms} ms</strong> on {s.fastest.title}</div>}
            {s.lightest && <div className="small">Lowest memory: <strong className="mono">{(s.lightest.kb / 1024).toFixed(1)} MB</strong> on {s.lightest.title}</div>}
          </section>
          <section className="card stack">
            <h3>Verdicts</h3>
            {verdicts.length === 0 ? <Empty>Nothing judged yet.</Empty> : <BarList rows={verdicts} />}
            <h3 style={{ marginTop: "0.5rem" }}>Languages</h3>
            {s.languages.length === 0 ? <Empty>No accepted solutions yet.</Empty> : <BarList rows={s.languages.map((l) => ({ label: LANGUAGE_NAMES[l.code] ?? l.code, value: l.accepted }))} />}
          </section>
        </div>

        <section className="card stack">
          <h3>Contests</h3>
          {d.contests.length === 0 ? <Empty>No finished public contests yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Contest</th><th className="right">Place</th><th className="right">Solved</th><th className="right">Rating</th><th /></tr></thead>
                <tbody>{d.contests.map((c) => (
                  <tr key={c.run_id}>
                    <td><strong>{c.title}</strong>
                      <div className="small muted">{when(c.starts_at)} · {SCORING_INFO[c.scoring_system]?.name ?? c.scoring_system}
                        {c.team_id ? <> · <a href={"#/team/" + c.team_id}>{c.entry_name}</a></> : ""}{c.rated ? "" : " · Unrated"}</div></td>
                    <td className="right mono">#{c.rank} / {c.entrants}</td>
                    <td className="right mono">{c.solved}</td>
                    <td className="right mono">{c.delta == null ? "–" : c.delta >= 0 ? "▲ +" + c.delta : "▼ " + c.delta}</td>
                    <td className="right"><button className="small" onClick={() => setReplay(c)}>Replay</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <section className="card stack">
            <h3>Teams</h3>
            {d.teams.length === 0 ? <Empty>Not in a team.</Empty> : d.teams.map((t) => <a key={t.id} href={"#/team/" + t.id} className="person"><strong>{t.name}</strong></a>)}
            {d.playedWith.length > 0 && <h3 style={{ marginTop: "0.5rem" }}>Played with</h3>}
            {d.playedWith.map((p) => (
              <a key={p.handle} href={"#/u/" + p.handle} className="row person" style={{ gap: "0.6rem" }}>
                <Avatar handle={p.handle} size={30} /><span><strong>{p.display_name}</strong><div className="small muted">{p.contests} contest{Number(p.contests) === 1 ? "" : "s"} together</div></span>
              </a>
            ))}
          </section>
          {d.own && <Rivals />}
        </div>
      </div>

      {dialog === "edit" && <EditProfile d={d} onClose={() => setDialog(null)} onSaved={profile.reload} />}
      {dialog === "password" && <ChangePassword onClose={() => setDialog(null)} />}
      {dialog === "share" && <ShareCard d={d} onClose={() => setDialog(null)} />}
      {replay && <Replay handle={u.handle} contest={replay} onClose={() => setReplay(null)} />}
    </main>
  );
}
