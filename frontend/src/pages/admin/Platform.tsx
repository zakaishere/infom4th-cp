import { useState } from "react";
import { post, put } from "../../api";
import { useAction, useData } from "../../app";
import { Badge, Empty, ErrorBox, Field, LANGUAGE_NAMES, Loading, ReasonDialog, Stat, when } from "../../ui";

type ImportRow = { email: string; handle: string; displayName?: string; role?: string };
type ImportResult = ImportRow & { status: string; error?: string; password?: string };

/** Accepts CSV with a header (email,handle,displayName,role) or plain rows in that column order. */
function parseUsers(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l: string) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = header.includes("email");
  const index = (name: string, fallback: number) => (hasHeader ? header.indexOf(name.toLowerCase()) : fallback);
  const cols = { email: index("email", 0), handle: index("handle", 1), displayName: index("displayName", 2), role: index("role", 3) };
  return (hasHeader ? lines.slice(1) : lines).map(split).map((c) => ({
    email: c[cols.email] ?? "", handle: c[cols.handle] ?? (c[cols.email] ?? "").split("@")[0].replace(/[^A-Za-z0-9_]/g, "_"),
    displayName: cols.displayName >= 0 ? c[cols.displayName] || undefined : undefined, role: cols.role >= 0 ? c[cols.role]?.toUpperCase() || undefined : undefined,
  }));
}

function download(name: string, rows: ImportResult[]) {
  const csv = ["email,handle,displayName,role,password,status,error",
    ...rows.map((r) => [r.email, r.handle, r.displayName ?? "", r.role ?? "", r.password ?? "", r.status, r.error ?? ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BulkImport({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [contest, setContest] = useState("");
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const contests = useData<{ id: string; title: string; status: string }[]>("/api/manage/competitions");
  const { busy, run } = useAction();
  const rows = parseUsers(text);
  const open = (contests.data ?? []).filter((c) => !["RUNNING", "FINISHED", "ARCHIVED"].includes(c.status));
  return (
    <section className="card stack">
      <h3 style={{ margin: 0 }}>Import users</h3>
      <p className="small muted" style={{ margin: 0 }}>Paste CSV or upload a .csv file with columns <code>email,handle,displayName,role</code> (header optional; role is PARTICIPANT, MODERATOR or ADMIN).
        Passwords are generated and shown once — download them before leaving this page.</p>
      <div className="grid grid-2">
        <textarea rows={6} className="mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={"email,handle,displayName\nali@school.ma,ali_b,Ali B.\nsara@school.ma,sara_k,Sara K."} />
        <div className="stack">
          <input type="file" accept=".csv,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ""; }} />
          <Field label="Also register them in a contest (optional)" hint="Individual contests that have not started.">
            <select value={contest} onChange={(e) => setContest(e.target.value)}><option value="">— none —</option>{open.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
          </Field>
          <div className="row"><button className="primary" disabled={busy || rows.length === 0 || rows.length > 300} onClick={() => setConfirming(true)}>Create {rows.length} account{rows.length === 1 ? "" : "s"}</button>
            {rows.length > 300 && <span className="small" style={{ color: "var(--danger)" }}>Maximum 300 per import</span>}</div>
        </div>
      </div>
      {rows.length > 0 && !results && (
        <div className="table-wrap"><table><thead><tr><th>Email</th><th>Handle</th><th>Name</th><th>Role</th></tr></thead>
          <tbody>{rows.slice(0, 50).map((r, i) => <tr key={i}><td className="small">{r.email}</td><td className="small mono">{r.handle}</td><td className="small">{r.displayName ?? r.handle}</td><td className="small">{r.role ?? "PARTICIPANT"}</td></tr>)}</tbody></table>
          {rows.length > 50 && <span className="small muted">…and {rows.length - 50} more</span>}</div>
      )}
      {results && (
        <div className="stack">
          <div className="row-between"><strong>{results.filter((r) => r.status === "CREATED").length} created, {results.filter((r) => r.status !== "CREATED").length} failed</strong>
            <button className="primary small" onClick={() => download("accounts.csv", results)}>Download CSV with passwords</button></div>
          <div className="table-wrap"><table><thead><tr><th>Handle</th><th>Email</th><th>Result</th><th>Password</th></tr></thead>
            <tbody>{results.map((r, i) => <tr key={i}><td className="mono small">{r.handle}</td><td className="small">{r.email}</td>
              <td>{r.status === "CREATED" ? <Badge tone="ok">Created</Badge> : <Badge tone="bad">{r.error ?? r.status}</Badge>}</td><td className="mono small">{r.password ?? ""}</td></tr>)}</tbody></table></div>
        </div>
      )}
      {confirming && <ReasonDialog title={`Create ${rows.length} accounts`} confirm="Create accounts" onClose={() => setConfirming(false)}
        onSubmit={(reason) => run(async () => {
          const r = await post<{ results: ImportResult[] }>("/api/admin/users/bulk", { reason, users: rows });
          const created = r.results.filter((x) => x.status === "CREATED");
          if (contest && created.length) await post("/api/manage/competitions/" + contest + "/participants", { users: created.map((x) => x.handle) });
          setResults(r.results); setConfirming(false); setText(""); onDone();
        }, "Import finished")} />}
    </section>
  );
}

export function Users() {
  const [offset, setOffset] = useState(0);
  const users = useData<{ id: string; email: string; handle: string; display_name: string; status: string }[]>("/api/admin/users?offset=" + offset);
  const [grant, setGrant] = useState<{ id: string; handle: string; role: string } | null>(null);
  const { run } = useAction();
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Users & roles</h1><p>Grants are additive and audited. ADMIN organizes contests, MODERATOR sets problems, SUPER_ADMIN manages the platform.</p></div></div>
      <BulkImport onDone={users.reload} />
      <ErrorBox error={users.error} />
      {users.loading ? <Loading /> : (
        <div className="card table-wrap"><table>
          <thead><tr><th>User</th><th>Email</th><th>Status</th><th /></tr></thead>
          <tbody>{(users.data ?? []).map((u) => (
            <tr key={u.id}>
              <td><strong>{u.display_name}</strong><div className="small muted">@{u.handle}</div></td>
              <td className="small">{u.email}</td>
              <td><Badge tone={u.status === "ACTIVE" ? "ok" : "neutral"}>{u.status}</Badge></td>
              <td className="right"><div className="row" style={{ justifyContent: "flex-end" }}>
                {["MODERATOR", "ADMIN", "SUPER_ADMIN"].map((role) => <button key={role} className="small" onClick={() => setGrant({ id: u.id, handle: u.handle, role })}>+ {role}</button>)}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="row"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button><button disabled={(users.data?.length ?? 0) < 100} onClick={() => setOffset(offset + 100)}>Next</button></div>
      {grant && <ReasonDialog title={`Grant ${grant.role} to @${grant.handle}`} confirm="Grant role" danger={grant.role === "SUPER_ADMIN"} onClose={() => setGrant(null)}
        onSubmit={(reason) => run(async () => { await put("/api/admin/users/" + grant.id + "/roles", { role: grant.role, reason }); setGrant(null); }, "Role granted. It applies at the user's next request.")} />}
    </div>
  );
}

export function Languages() {
  const languages = useData<{ code: string; display_name: string; enabled: boolean; runtime_image_id: string | null; admin_locked: boolean; verified_image_id: string | null }[]>("/api/admin/languages", 10000);
  const [change, setChange] = useState<{ code: string; enabled: boolean; imageId?: string } | null>(null);
  const { run } = useAction();
  const rows = languages.data ?? [];
  const state = (l: (typeof rows)[number]) =>
    l.enabled && l.verified_image_id === l.runtime_image_id ? "ready" : l.enabled ? (l.verified_image_id ? "rebuilt" : "no-judge") : l.verified_image_id ? "available" : "missing";
  const LABEL: Record<string, [string, string, string]> = {
    ready: ["ok", "Ready", "Contestants can use it."],
    rebuilt: ["warn", "Image changed", "The judge runs a newer image than the enabled one. Switch to it so new problems use it."],
    "no-judge": ["warn", "No judge online", "Enabled, but no online judge verified it. Submissions wait until a judge starts."],
    available: ["info", "Turned off", "A judge verified it; turn it on to offer it."],
    missing: ["neutral", "Not installed", "Build its image and add it to JUDGE_LANGUAGES in .env on the judge server."],
  };
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Languages</h1>
        <p>Languages turn on automatically when a judge verifies them at startup. Turn one off here to stop offering it. New problems offer every language that is ready.</p></div></div>
      <div className="stat-tiles">
        <Stat label="Ready" value={rows.filter((l) => state(l) === "ready").length} tone="ok" />
        <Stat label="Need attention" value={rows.filter((l) => ["rebuilt", "no-judge"].includes(state(l))).length} tone="warn" />
        <Stat label="Not installed" value={rows.filter((l) => state(l) === "missing").length} />
      </div>
      {languages.loading ? <Loading /> : (
        <div className="card table-wrap"><table>
          <thead><tr><th>Language</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((l) => {
            const st = state(l), [tone, label, help] = LABEL[st];
            return (
              <tr key={l.code}>
                <td><strong>{LANGUAGE_NAMES[l.code] ?? l.display_name}</strong><div className="small muted">{l.display_name}</div></td>
                <td><Badge tone={tone}>{label}</Badge><div className="small muted">{help}</div>
                  {(l.runtime_image_id || l.verified_image_id) && <details className="small"><summary className="muted">Technical details</summary>
                    <div className="mono">enabled image: {l.runtime_image_id?.slice(7, 19) ?? "—"}<br />judge image: {l.verified_image_id?.slice(7, 19) ?? "—"}{l.admin_locked ? <><br />set manually by an administrator</> : null}</div></details>}
                </td>
                <td className="right">
                  {(st === "available" || st === "rebuilt") && <button className="small primary" onClick={() => setChange({ code: l.code, enabled: true, imageId: l.verified_image_id! })}>{st === "rebuilt" ? "Use new image" : "Turn on"}</button>}
                  {l.enabled && <button className="small danger" style={{ marginLeft: 6 }} onClick={() => setChange({ code: l.code, enabled: false })}>Turn off</button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {change && <ReasonDialog title={(change.enabled ? "Turn on " : "Turn off ") + (LANGUAGE_NAMES[change.code] ?? change.code)} danger={!change.enabled} onClose={() => setChange(null)}
        description={change.enabled ? "Contestants can choose it on new problems." : "New submissions in this language are refused. It stays off until you turn it on again."}
        onSubmit={(reason) => run(async () => { await put("/api/admin/languages/" + change.code, { enabled: change.enabled, imageId: change.imageId, reason }); setChange(null); languages.reload(); }, "Language updated")} />}
    </div>
  );
}

export function Audit() {
  const [type, setType] = useState("");
  const log = useData<{ id: number; actor_handle: string | null; action: string; resource_type: string; resource_id: string | null; reason: string | null; metadata: string; created_at: string }[]>("/api/admin/audit?latest=true" + (type ? "&type=" + type : ""), 15000);
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Audit log</h1><p>Append-only record of privileged actions with actor, time, reason and previous/new values.</p></div>
        <Field label="Resource"><select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 220 }}>
          <option value="">All</option><option value="judging_settings">Judging settings</option><option value="worker">Workers</option><option value="run">Runs</option><option value="competition">Competitions</option><option value="submission">Submissions</option><option value="user">Users</option><option value="language">Languages</option></select></Field></div>
      <ErrorBox error={log.error} />
      {log.loading ? <Loading /> : !log.data?.length ? <Empty>No entries.</Empty> : (
        <div className="card table-wrap"><table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Reason</th><th>Changes</th></tr></thead>
          <tbody>{log.data.map((a) => (
            <tr key={a.id}>
              <td className="small">{when(a.created_at)}</td>
              <td className="small">{a.actor_handle ? "@" + a.actor_handle : "system"}</td>
              <td><strong className="small">{a.action}</strong><div className="small muted mono">{a.resource_type}</div></td>
              <td className="small">{a.reason}</td>
              <td className="small mono">{a.metadata && a.metadata !== "{}" ? <pre style={{ margin: 0 }}>{JSON.stringify(JSON.parse(a.metadata), null, 1)}</pre> : ""}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="small muted">Shows the newest 200 entries matching the filter.</p>
    </div>
  );
}
