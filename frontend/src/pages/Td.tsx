import { useMemo } from "react";
import { navigate, useData } from "../app";
import { Empty, ErrorBox, Loading, Ring } from "../ui";
import { DifficultyPill, StatusIcon, acceptance, type PracticeProblem } from "./Practice";

/** Themes of the C programming TDs; a TD without an entry is shown by its number only. */
const THEMES: Record<number, string> = {
  1: "Opérateurs, conditions et entrées/sorties",
  2: "Boucles",
  3: "Tableaux et matrices",
  4: "Chaînes de caractères",
  5: "Pointeurs, fonctions et allocation dynamique",
  6: "Fichiers",
};

/** Academic section: the TD exercises as judged problems, grouped by TD in course order. */
export default function TdList() {
  const catalog = useData<{ problems: PracticeProblem[] }>("/api/td", 60000);
  const all = catalog.data?.problems ?? [];
  const groups = useMemo(() => {
    const byTd = new Map<number, PracticeProblem[]>();
    for (const p of all) byTd.set(p.td_number ?? 0, [...(byTd.get(p.td_number ?? 0) ?? []), p]);
    return [...byTd.entries()].sort((a, b) => a[0] - b[0]);
  }, [all]);
  const solved = all.filter((p) => p.my_status === "SOLVED").length;
  // Continue where the student stopped: the first unsolved problem in course order.
  const next = all.find((p) => p.my_status !== "SOLVED");

  return (
    <main className="page page-wide">
      <section className="practice-hero">
        <div className="stack" style={{ gap: "0.4rem" }}>
          <div className="eyebrow">Academic · Programmation en C</div>
          <h1 style={{ margin: 0 }}>TD — Travaux dirigés</h1>
          <p className="muted" style={{ margin: 0, maxWidth: 600 }}>The exercises of each TD session, as problems judged on hidden tests.
            Read the input, print only the answer (no "Entrez …" prompts), and submit in C or any allowed language.</p>
          {next && <div><button className="primary" onClick={() => navigate("/td/" + next.id)}>{solved ? "Continue" : "Start"}: TD {next.td_number} · {next.title}</button></div>}
        </div>
        <div className="practice-progress">
          <Ring value={solved} max={all.length || 1} size={96}><strong>{solved}</strong><span className="muted">/ {all.length}</span></Ring>
          <div className="stack" style={{ gap: "0.45rem", minWidth: 200 }}>
            <strong>Your progress</strong>
            {groups.map(([td, problems]) => {
              const done = problems.filter((p) => p.my_status === "SOLVED").length;
              return (
                <div key={td} className="progress-line">
                  <a href={"#/td"} onClick={(e) => { e.preventDefault(); document.getElementById("td-" + td)?.scrollIntoView({ behavior: "smooth" }); }} className="small">TD {td}</a>
                  <div className="bar diff-easy"><div style={{ width: (100 * done) / problems.length + "%" }} /></div>
                  <span className="small mono">{done}/{problems.length}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <ErrorBox error={catalog.error} />
      {catalog.loading ? <Loading /> : all.length === 0 ? (
        <Empty>No TD problems yet. They install themselves once a judge is online, or organizers can move practice problems into a TD from the Control room → Practice set.</Empty>
      ) : groups.map(([td, problems]) => {
        const done = problems.filter((p) => p.my_status === "SOLVED").length;
        return (
          <section key={td} id={"td-" + td} className="td-group">
            <div className="td-head">
              <h2>TD {td}{THEMES[td] && <span className="muted"> · {THEMES[td]}</span>}</h2>
              <span className={"badge " + (done === problems.length ? "ok" : "neutral")}>{done}/{problems.length} solved</span>
            </div>
            <div className="card table-wrap" style={{ padding: 0 }}>
              <table className="practice-table">
                <thead><tr><th style={{ width: 44 }} /><th style={{ width: 56 }}>Ex.</th><th>Problem</th><th>Difficulty</th><th className="right">Acceptance</th><th className="right">Solved by</th></tr></thead>
                <tbody>
                  {problems.map((p, i) => {
                    const rate = acceptance(p);
                    return (
                      <tr key={p.id} className={p.my_status === "SOLVED" ? "row-solved" : ""} onClick={() => navigate("/td/" + p.id)}>
                        <td><StatusIcon status={p.my_status} /></td>
                        <td className="mono muted">{td}.{i + 1}</td>
                        <td>
                          <a href={"#/td/" + p.id} className="problem-link" onClick={(e) => e.stopPropagation()}>{p.title}</a>
                          {p.tags.length > 0 && <div className="tags">{p.tags.map((t) => <span key={t} className="tag-chip small">{t}</span>)}</div>}
                        </td>
                        <td><DifficultyPill value={p.difficulty} /></td>
                        <td className="right mono">{rate == null ? <span className="muted">—</span> : rate + "%"}</td>
                        <td className="right"><span className="mono">{p.solved_by}</span> <span className="small muted">users</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </main>
  );
}
