import { useRef, useState } from "react";
import { navigate, useAuth, useData, useToast } from "../app";
import { patch } from "../api";
import { Empty, ErrorBox, Loading, Ring, when } from "../ui";

type Row = { problemId: string; version: string; title: string; weight: number; points: number; attempts: number; passed: number; total: number; solved: boolean; firstSolvedAt: string | null };
type Card = { handle?: string; name?: string; rank?: number; points: number; solved: number; attempts: number; lastProgressAt: string | null; problems: Row[] };
type Board = { rank: number; handle: string; name: string; points: number; solved: number; attempts: number; me: boolean };
type Mission = { slug: string; title: string; description: string; open: boolean; opens_at: string; closes_at: string | null; totalPoints: number; participants: number; me: Card; leaderboard: Board[] };
type Summary = { slug: string; title: string; description: string; open: boolean; problems: number; totalPoints: number; participants: number; myPoints?: number; myRank?: number; mySolved?: number };

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/** Missions: the TPs given in training sessions, scored by the best submission of each exercise. */
export function MissionList() {
  const missions = useData<{ missions: Summary[] }>("/api/missions", 30000);
  const list = missions.data?.missions ?? [];
  return (
    <main className="page page-wide">
      <section className="practice-hero">
        <div className="stack" style={{ gap: "0.4rem" }}>
          <div className="eyebrow">Formation</div>
          <h1 style={{ margin: 0 }}>Missions</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 620 }}>The TP of each training session, as a mission. Every exercise is worth points: your score is the points of your best submission, so retrying never hurts. Finish with a score card to share.</p>
        </div>
      </section>
      <ErrorBox error={missions.error} />
      {missions.loading ? <Loading /> : list.length === 0 ? <Empty>No mission yet. Organizers load one from Problem lab → Bulk import.</Empty> : (
        <div className="mission-grid">
          {list.map((m) => (
            <a key={m.slug} className="card mission-tile" href={"#/missions/" + m.slug}>
              <div className="td-head"><h2 style={{ margin: 0 }}>{m.title}</h2><span className={"badge " + (m.open ? "ok" : "neutral")}>{m.open ? "Open" : "Closed"}</span></div>
              {m.description && <p className="muted small" style={{ margin: 0 }}>{m.description}</p>}
              <div className="mission-meta small">
                <span><strong>{m.problems}</strong> exercises</span><span><strong>{fmt(m.totalPoints)}</strong> points</span><span><strong>{m.participants}</strong> participants</span>
              </div>
              <div className="bar diff-easy"><div style={{ width: (100 * (m.myPoints ?? 0)) / (m.totalPoints || 1) + "%" }} /></div>
              <span className="small mono">{m.myPoints === undefined ? "Not started" : `${fmt(m.myPoints)} / ${fmt(m.totalPoints)} pts · rank ${m.myRank}`}</span>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}

export function MissionPage({ slug }: { slug: string }) {
  const mission = useData<Mission>("/api/missions/" + slug, 15000);
  const { organizer } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const m = mission.data;
  if (mission.loading) return <Loading />;
  if (!m) return <main className="page"><ErrorBox error={mission.error} /><a href="#/missions">← Missions</a></main>;
  const me = m.me;
  const next = me.problems.find((p) => !p.solved);
  const change = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await patch("/api/manage/missions/" + slug, body); toast("success", done); await mission.reload(); }
    catch (e) { toast("error", e instanceof Error ? e.message : "Could not update the mission"); }
    finally { setBusy(false); }
  };
  return (
    <main className="page page-wide">
      <a href="#/missions" className="small">← Missions</a>
      <section className="practice-hero">
        <div className="stack" style={{ gap: "0.4rem" }}>
          <div className="eyebrow">Mission · {m.open ? "open" : "closed"}</div>
          <h1 style={{ margin: 0 }}>{m.title}</h1>
          {m.description && <p className="muted" style={{ margin: 0, maxWidth: 620 }}>{m.description}</p>}
          <div className="row" style={{ gap: "0.6rem", flexWrap: "wrap" }}>
            {next && m.open && <button className="primary" onClick={() => navigate("/missions/" + slug + "/" + next.version)}>{me.attempts ? "Continue" : "Start"}: {next.title}</button>}
            {me.handle && <a className="btn" href={"#/missions/" + slug + "/card/" + me.handle}>My score card</a>}
          </div>
        </div>
        <div className="practice-progress">
          <Ring value={me.points} max={m.totalPoints || 1} size={96}><strong>{fmt(me.points)}</strong><span className="muted">/ {fmt(m.totalPoints)}</span></Ring>
          <div className="stack" style={{ gap: "0.2rem" }}>
            <strong>{me.rank ? "Rank " + me.rank + " of " + m.participants : "No submission yet"}</strong>
            <span className="small muted">{me.solved}/{me.problems.length} solved · {me.attempts} attempts</span>
          </div>
        </div>
      </section>

      <section className="card table-wrap" style={{ padding: 0 }}>
        <table className="practice-table">
          <thead><tr><th style={{ width: 44 }} /><th style={{ width: 56 }}>Ex.</th><th>Exercise</th><th className="right">Tests</th><th className="right">Points</th><th className="right">Attempts</th></tr></thead>
          <tbody>
            {me.problems.map((p, i) => (
              <tr key={p.problemId} className={p.solved ? "row-solved" : ""} onClick={() => navigate("/missions/" + slug + "/" + p.version)}>
                <td><span className={"status-icon " + (p.solved ? "solved" : p.attempts ? "tried" : "")}>{p.solved ? "✓" : p.attempts ? "●" : ""}</span></td>
                <td className="mono muted">{i + 1}</td>
                <td><a href={"#/missions/" + slug + "/" + p.version} className="problem-link" onClick={(e) => e.stopPropagation()}>{p.title}</a></td>
                <td className="right mono">{p.total ? `${p.passed}/${p.total}` : "—"}</td>
                <td className="right mono"><strong>{fmt(p.points)}</strong> <span className="muted">/ {fmt(p.weight)}</span></td>
                <td className="right mono">{p.attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="stack" style={{ marginTop: "1.5rem" }}>
        <div className="section-title"><h3>Leaderboard</h3><span className="count">{m.participants}</span></div>
        {m.leaderboard.length === 0 ? <Empty>Nobody has submitted yet.</Empty> : (
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="practice-table">
              <thead><tr><th style={{ width: 56 }}>#</th><th>Participant</th><th className="right">Points</th><th className="right">Solved</th><th className="right">Attempts</th><th /></tr></thead>
              <tbody>
                {m.leaderboard.map((r) => (
                  <tr key={r.handle} className={r.me ? "row-solved" : ""}>
                    <td className="mono">{r.rank}</td>
                    <td><a href={"#/u/" + r.handle}>{r.name}</a> <span className="muted small">@{r.handle}</span></td>
                    <td className="right mono"><strong>{fmt(r.points)}</strong></td>
                    <td className="right mono">{r.solved}/{me.problems.length}</td>
                    <td className="right mono">{r.attempts}</td>
                    <td className="right"><a className="small" href={"#/missions/" + slug + "/card/" + r.handle}>Card</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <span className="small muted">Ranking: points, then fewer attempts, then who reached the score first. Organizers are not ranked.</span>
      </section>

      {organizer && (
        <section className="card stack" style={{ marginTop: "1.5rem" }}>
          <div className="section-title"><h3>Organizer</h3></div>
          <p className="small muted" style={{ margin: 0 }}>Counted window: from {when(m.opens_at)}{m.closes_at ? " to " + when(m.closes_at) : " until you close it"}. Submissions outside it do not count.</p>
          <div className="row" style={{ gap: "0.6rem", flexWrap: "wrap" }}>
            {m.open
              ? <button disabled={busy} onClick={() => change({ open: false }, "Mission closed")}>Close the mission</button>
              : <button disabled={busy} onClick={() => change({ open: true }, "Mission reopened")}>Reopen</button>}
            <button className="ghost" disabled={busy} onClick={() => { if (window.confirm("Restart the mission now? Submissions made before now stop counting.")) change({ restart: true }, "Mission restarted"); }}>Restart for a new session</button>
          </div>
          <span className="small muted">Points per exercise come from the bank file (Problem lab → Bulk import). To reweigh one, send <code>PATCH /api/manage/missions/{slug}</code> with <code>{"{\"weights\":{\"<problemId>\":12}}"}</code>.</span>
        </section>
      )}
    </main>
  );
}

/** Score card of one participant: share the link, or download it as an image to send to the trainers. */
export function MissionCard({ slug, handle }: { slug: string; handle: string }) {
  const data = useData<{ mission: { slug: string; title: string; totalPoints: number; participants: number }; card: Card }>("/api/missions/" + slug + "/card/" + encodeURIComponent(handle), 20000);
  const toast = useToast();
  const canvas = useRef<HTMLCanvasElement>(null);
  if (data.loading) return <Loading />;
  if (!data.data) return <main className="page"><ErrorBox error={data.error} /><a href={"#/missions/" + slug}>← Mission</a></main>;
  const { mission, card } = data.data;
  const link = window.location.origin + window.location.pathname + "#/missions/" + slug + "/card/" + (card.handle ?? handle);

  const download = () => {
    const rows = card.problems, w = 900, h = 250 + rows.length * 46 + 70, c = canvas.current!;
    c.width = w; c.height = h;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0c3547"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#3ec6a8"; g.fillRect(0, 0, w, 8);
    g.fillStyle = "#9fc3d1"; g.font = "600 18px sans-serif"; g.fillText("MISSION · SCORE CARD", 40, 56);
    g.fillStyle = "#ffffff"; g.font = "700 34px sans-serif"; g.fillText(mission.title, 40, 100);
    g.font = "500 22px sans-serif"; g.fillText((card.name ?? "") + "  @" + (card.handle ?? handle), 40, 140);
    g.fillStyle = "#3ec6a8"; g.font = "700 64px sans-serif"; g.fillText(fmt(card.points) + " / " + fmt(mission.totalPoints), 40, 214);
    g.fillStyle = "#cfe3ea"; g.font = "500 20px sans-serif";
    g.fillText(`Rank ${card.rank ?? "-"} of ${mission.participants}   ·   ${card.solved}/${rows.length} solved   ·   ${card.attempts} attempts`, 40, 244 + 6);
    rows.forEach((r, i) => {
      const y = 290 + i * 46;
      g.fillStyle = "#ffffff"; g.font = "500 18px sans-serif"; g.fillText(r.title.slice(0, 44), 40, y + 20);
      g.fillStyle = "#1c5068"; g.fillRect(470, y + 4, 220, 18);
      g.fillStyle = r.solved ? "#3ec6a8" : "#e0b14a"; g.fillRect(470, y + 4, 220 * (r.weight ? r.points / r.weight : 0), 18);
      g.fillStyle = "#cfe3ea"; g.textAlign = "right"; g.fillText(`${fmt(r.points)}/${fmt(r.weight)}`, 790, y + 20); g.fillText(r.attempts + " att.", 860, y + 20); g.textAlign = "left";
    });
    g.fillStyle = "#9fc3d1"; g.font = "400 14px sans-serif"; g.fillText("InfoM4th · " + new Date().toLocaleDateString(), 40, h - 24);
    const a = document.createElement("a");
    a.download = `${slug}-${card.handle ?? handle}.png`; a.href = c.toDataURL("image/png"); a.click();
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast("success", "Link copied"); } catch { toast("error", "Copy the address from the browser bar"); } };

  return (
    <main className="page">
      <a href={"#/missions/" + slug} className="small">← {mission.title}</a>
      <section className="card stack mission-card">
        <div className="eyebrow">Score card · {mission.title}</div>
        <h1 style={{ margin: 0 }}>{card.name} <span className="muted small">@{card.handle}</span></h1>
        <div className="mission-meta">
          <span><strong>{fmt(card.points)}</strong> / {fmt(mission.totalPoints)} points</span>
          <span>Rank <strong>{card.rank}</strong> of {mission.participants}</span>
          <span><strong>{card.solved}</strong>/{card.problems.length} solved</span>
          <span><strong>{card.attempts}</strong> attempts</span>
        </div>
        <table className="practice-table">
          <thead><tr><th>Exercise</th><th className="right">Tests</th><th className="right">Points</th><th className="right">Attempts</th><th className="right">First solved</th></tr></thead>
          <tbody>
            {card.problems.map((r) => (
              <tr key={r.problemId}>
                <td>{r.solved ? "✓ " : ""}{r.title}</td>
                <td className="right mono">{r.total ? `${r.passed}/${r.total}` : "—"}</td>
                <td className="right mono">{fmt(r.points)} / {fmt(r.weight)}</td>
                <td className="right mono">{r.attempts}</td>
                <td className="right small muted">{r.firstSolvedAt ? when(r.firstSolvedAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ gap: "0.6rem", flexWrap: "wrap" }}>
          <button className="primary" onClick={download}>Download as image</button>
          <button onClick={copy}>Copy link</button>
        </div>
        <span className="small muted">The link opens for anyone signed in to the platform.</span>
        <canvas ref={canvas} style={{ display: "none" }} />
      </section>
    </main>
  );
}
