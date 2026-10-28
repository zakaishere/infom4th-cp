import { useEffect, useState } from "react";
import { useData } from "../app";
import { ProblemStatement, SubmissionModal, SubmissionTable, SubmitPanel, pending, type ProblemDetail, type SubmissionRow } from "../components/Problem";
import { Badge, Empty, ErrorBox, Loading } from "../ui";

export function PracticeList() {
  const list = useData<{ id: string; title: string; slug: string; difficulty: string | null }[]>("/api/practice");
  const [filter, setFilter] = useState("");
  const shown = (list.data ?? []).filter((p) => (p.title + " " + p.slug).toLowerCase().includes(filter.toLowerCase()));
  return (
    <main className="page">
      <div className="page-head">
        <div><div className="eyebrow">Train between contests</div><h1>Practice</h1><p>Published problems judged by the same sandbox as contests, on the internal judging lane.</p></div>
        <input placeholder="Search problems" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 280 }} />
      </div>
      <ErrorBox error={list.error} />
      {list.loading ? <Loading /> : shown.length === 0 ? <Empty>No practice problems match.</Empty> : (
        <div className="grid grid-3">
          {shown.map((p) => (
            <a key={p.id} href={"#/practice/" + p.id} className="card stack" style={{ color: "inherit", textDecoration: "none" }}>
              <h3 style={{ margin: 0 }}>{p.title}</h3>
              <div className="row"><span className="small muted mono">{p.slug}</span>{p.difficulty && <Badge tone="info">{p.difficulty}</Badge>}</div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}

export function PracticeProblem({ versionId }: { versionId: string }) {
  const problem = useData<ProblemDetail>("/api/practice/" + versionId);
  const history = useData<SubmissionRow[]>("/api/submissions");
  const mine = (history.data ?? []).filter((s) => s.problem_version_id === versionId && s.problem_slot == null);
  const anyPending = mine.some(pending);
  const [open, setOpen] = useState<string | null>(null);
  const reload = history.reload;
  useEffect(() => {
    if (!anyPending) return;
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
  }, [anyPending, reload]);
  if (problem.loading) return <Loading />;
  if (!problem.data) return <main className="page"><ErrorBox error={problem.error} /></main>;
  return (
    <main className="page page-wide">
      <a href="#/practice" className="small">← All practice problems</a>
      <div className="grid grid-2" style={{ marginTop: "1rem", alignItems: "start" }}>
        <section className="card"><ProblemStatement problem={problem.data} /></section>
        <section className="stack">
          <div className="card" style={{ minHeight: 480, display: "flex", flexDirection: "column" }}>
            <SubmitPanel scope={"practice." + versionId} languages={problem.data.languages}
              path={"/api/practice/" + versionId + "/submissions"} onSubmitted={reload} />
          </div>
          <div className="card"><h3>Your submissions</h3><SubmissionTable rows={mine} onOpen={setOpen} /></div>
        </section>
      </div>
      {open && <SubmissionModal id={open} onClose={() => setOpen(null)} />}
    </main>
  );
}
