import { useEffect, useState } from "react";
import { post, put } from "../../api";
import { useAction, useData } from "../../app";
import { Badge, Empty, ErrorBox, Field, LANGUAGE_NAMES, Loading, ReasonDialog, Stat, UserLink, ago, when } from "../../ui";

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

/** A user's role is their highest one; every account also keeps PARTICIPANT. */
const ROLES: Record<string, { label: string; tone: string; help: string }> = {
  SUPER_ADMIN: { label: "Super admin", tone: "bad", help: "Manages the whole platform: users, judges, languages" },
  ADMIN: { label: "Organizer", tone: "warn", help: "Creates and runs contests" },
  MODERATOR: { label: "Problem setter", tone: "info", help: "Writes and tests problems" },
  PARTICIPANT: { label: "Participant", tone: "neutral", help: "Takes part in contests and practice" },
};
const ROLE_ORDER = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "PARTICIPANT"];
const mainRole = (roles: string[]) => ROLE_ORDER.find((r) => roles.includes(r)) ?? "PARTICIPANT";

type UserRow = { id: string; email: string; handle: string; display_name: string; status: string; roles: string[]; created_at: string; last_seen_at: string | null; submissions: number };
type RoleChange = { id: string; handle: string; from: string; to: string };
type StatusChange = { id: string; handle: string; status: string };

function RoleBadge({ role }: { role: string }) {
  return <Badge tone={ROLES[role]?.tone ?? "neutral"}>{ROLES[role]?.label ?? role}</Badge>;
}

/** Shared confirmation dialogs for role and status changes. */
function UserDialogs({ role, status, onClose, onDone }: { role: RoleChange | null; status: StatusChange | null; onClose: () => void; onDone: () => void }) {
  const { run } = useAction();
  return (
    <>
      {role && <ReasonDialog title={`Make @${role.handle} ${ROLES[role.to].label.toLowerCase()}`} confirm="Change role" danger={role.to === "SUPER_ADMIN" || role.from === "SUPER_ADMIN"}
        description={<>From <RoleBadge role={role.from} /> to <RoleBadge role={role.to} />. {ROLES[role.to].help}. It applies at the user's next request.</>} onClose={onClose}
        onSubmit={(reason) => run(async () => { await put("/api/admin/users/" + role.id + "/role", { role: role.to, reason }); onClose(); onDone(); }, "Role changed")} />}
      {status && <ReasonDialog title={(status.status === "ACTIVE" ? "Reactivate" : "Suspend") + " @" + status.handle} confirm={status.status === "ACTIVE" ? "Reactivate" : "Suspend"} danger={status.status !== "ACTIVE"}
        description={status.status === "ACTIVE" ? "The user can sign in again." : "The user is signed out everywhere and cannot sign in. Their submissions and results are kept."} onClose={onClose}
        onSubmit={(reason) => run(async () => { await put("/api/admin/users/" + status.id + "/status", { status: status.status, reason }); onClose(); onDone(); }, "Status changed")} />}
    </>
  );
}

export function Users({ importOpen = false }: { importOpen?: boolean }) {
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(importOpen);
  const [roleChange, setRoleChange] = useState<RoleChange | null>(null);
  const [statusChange, setStatusChange] = useState<StatusChange | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setOffset(0); }, 300); return () => clearTimeout(t); }, [search]);
  const params = new URLSearchParams({ offset: String(offset) });
  if (q) params.set("q", q); if (role) params.set("role", role); if (status) params.set("status", status);
  const users = useData<{ total: number; users: UserRow[]; roleCounts: { role: string; count: number }[] }>("/api/admin/users?" + params);
  const counts = Object.fromEntries((users.data?.roleCounts ?? []).map((c) => [c.role, c.count]));
  const total = users.data?.total ?? 0;
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Users & roles</h1><p>Each user has one role. Changes are audited and apply at the user's next request.</p></div>
        <button className={importing ? "" : "primary"} onClick={() => setImporting(!importing)}>{importing ? "Close import" : "+ Import users"}</button>
      </div>
      {importing && <BulkImport onDone={users.reload} />}
      <div className="stat-tiles">
        {ROLE_ORDER.slice(0, 3).map((r) => <Stat key={r} label={ROLES[r].label + "s"} value={counts[r] ?? 0} />)}
        <Stat label="All users" value={counts.PARTICIPANT ?? "…"} />
      </div>
      <div className="card row" style={{ alignItems: "flex-end" }}>
        <Field label="Search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, handle or email" style={{ minWidth: 240 }} /></Field>
        <Field label="Role"><select value={role} onChange={(e) => { setRole(e.target.value); setOffset(0); }}>
          <option value="">All roles</option>{ROLE_ORDER.map((r) => <option key={r} value={r}>{r === "PARTICIPANT" ? "Participants only" : ROLES[r].label}</option>)}</select></Field>
        <Field label="Status"><select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
          <option value="">Any status</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="DISABLED">Disabled</option></select></Field>
        {(search || role || status) && <button className="small" onClick={() => { setSearch(""); setRole(""); setStatus(""); }}>Clear filters</button>}
      </div>
      <ErrorBox error={users.error} />
      {users.loading ? <Loading /> : !users.data?.users.length ? <Empty>No user matches these filters.</Empty> : (
        <div className="card table-wrap"><table>
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Submissions</th><th>Last sign-in</th><th>Change role</th><th /></tr></thead>
          <tbody>{users.data.users.map((u) => {
            const current = mainRole(u.roles);
            return (
              <tr key={u.id}>
                <td><a href={"#/admin/users/" + u.id}><strong>{u.display_name}</strong></a><div className="small muted"><UserLink handle={u.handle} /> · {u.email}</div></td>
                <td><RoleBadge role={current} /></td>
                <td><Badge tone={u.status === "ACTIVE" ? "ok" : "bad"}>{u.status}</Badge></td>
                <td className="small">{u.submissions}</td>
                <td className="small">{u.last_seen_at ? ago(u.last_seen_at) : "never"}</td>
                <td><select value={current} aria-label={"Role of @" + u.handle} onChange={(e) => setRoleChange({ id: u.id, handle: u.handle, from: current, to: e.target.value })} style={{ minWidth: 150 }}>
                  {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}</select></td>
                <td className="right"><a className="btn small" href={"#/admin/users/" + u.id}>Details & log</a></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <div className="row"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Previous</button>
        <span className="small muted">{total ? `${offset + 1}–${Math.min(offset + 100, total)} of ${total}` : ""}</span>
        <button disabled={offset + 100 >= total} onClick={() => setOffset(offset + 100)}>Next</button></div>
      <UserDialogs role={roleChange} status={statusChange} onClose={() => { setRoleChange(null); setStatusChange(null); }} onDone={users.reload} />
    </div>
  );
}

type AuditRow = { id: number; actor_handle: string | null; action: string; resource_type: string; resource_id: string | null; reason: string | null; metadata: string; created_at: string; target_handle?: string | null; by_user?: boolean };

function AuditTable({ rows, showActor = true }: { rows: AuditRow[]; showActor?: boolean }) {
  return (
    <div className="card table-wrap"><table>
      <thead><tr><th>When</th>{showActor && <th>Actor</th>}<th>Action</th><th>Reason</th><th>Changes</th></tr></thead>
      <tbody>{rows.map((a) => (
        <tr key={a.id}>
          <td className="small">{when(a.created_at)}</td>
          {showActor && <td className="small">{a.actor_handle ? <UserLink handle={a.actor_handle} /> : "system"}</td>}
          <td><strong className="small">{a.action}</strong><div className="small muted mono">{a.resource_type}{a.target_handle ? <> · <UserLink handle={a.target_handle} /></> : ""}</div></td>
          <td className="small">{a.reason}</td>
          <td className="small mono">{a.metadata && a.metadata !== "{}" ? <pre style={{ margin: 0 }}>{JSON.stringify(JSON.parse(a.metadata), null, 1)}</pre> : ""}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export function UserDetail({ id }: { id: string }) {
  const user = useData<any>("/api/admin/users/" + id);
  const [roleChange, setRoleChange] = useState<RoleChange | null>(null);
  const [statusChange, setStatusChange] = useState<StatusChange | null>(null);
  const [filter, setFilter] = useState<"all" | "by" | "about">("all");
  if (user.error && !user.data) return <ErrorBox error={user.error} />;
  if (!user.data) return <Loading />;
  const u = user.data, a = u.activity;
  const roles: string[] = u.roles.map((r: any) => r.role);
  const current = mainRole(roles);
  const audit = (u.audit as AuditRow[]).filter((r) => filter === "all" || (filter === "by") === !!r.by_user);
  return (
    <div className="stack">
      <a href="#/admin/users" className="small">← All users</a>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>{u.display_name}</h1><p><UserLink handle={u.handle} className="quiet" /> · {u.email} · joined {when(u.created_at)}</p></div>
        <div className="row"><RoleBadge role={current} /><Badge tone={u.status === "ACTIVE" ? "ok" : "bad"}>{u.status}</Badge></div>
      </div>
      <div className="grid grid-2">
        <section className="card stack">
          <h3 style={{ margin: 0 }}>Role</h3>
          <div className="stack" style={{ gap: "0.4rem" }}>
            {ROLE_ORDER.map((r) => (
              <label key={r} className="row" style={{ cursor: "pointer", alignItems: "flex-start" }}>
                <input type="radio" name="role" checked={current === r} onChange={() => setRoleChange({ id: u.id, handle: u.handle, from: current, to: r })} />
                <span><strong>{ROLES[r].label}</strong><div className="small muted">{ROLES[r].help}</div></span>
              </label>
            ))}
          </div>
          <span className="small muted">{u.roles.filter((r: any) => r.role !== "PARTICIPANT").map((r: any) => `${ROLES[r.role]?.label ?? r.role} since ${when(r.granted_at)}${r.granted_by ? " by @" + r.granted_by : ""}`).join(" · ") || "No staff role."}</span>
          <div className="row">{u.status === "ACTIVE"
            ? <button className="small danger" onClick={() => setStatusChange({ id: u.id, handle: u.handle, status: "SUSPENDED" })}>Suspend account</button>
            : <button className="small primary" onClick={() => setStatusChange({ id: u.id, handle: u.handle, status: "ACTIVE" })}>Reactivate account</button>}</div>
        </section>
        <section className="card stack">
          <h3 style={{ margin: 0 }}>Activity</h3>
          <div className="capacity-numbers">
            <Stat label="Submissions" value={a.submissions} hint={`${a.accepted} accepted`} />
            <Stat label="Contests" value={a.contest_entries} />
            <Stat label="Teams" value={a.teams} />
            <Stat label="Problems owned" value={a.problems_owned} />
            <Stat label="Contests owned" value={a.competitions_owned} />
            <Stat label="Active sessions" value={a.active_sessions} />
          </div>
          <span className="small muted">Last sign-in {a.last_seen_at ? ago(a.last_seen_at) : "never"} · last submission {a.last_submission_at ? ago(a.last_submission_at) : "never"}</span>
        </section>
      </div>
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Audit log</h2>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {([["all", "Everything"], ["by", "Actions by this user"], ["about", "Changes to this user"]] as const).map(([k, l]) =>
            <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>
      {audit.length ? <AuditTable rows={audit} /> : <Empty>No audit entries.</Empty>}
      <UserDialogs role={roleChange} status={statusChange} onClose={() => { setRoleChange(null); setStatusChange(null); }} onDone={user.reload} />
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
  const [actorInput, setActorInput] = useState("");
  const [actor, setActor] = useState("");
  useEffect(() => { const t = setTimeout(() => setActor(actorInput.trim().replace(/^@/, "")), 300); return () => clearTimeout(t); }, [actorInput]);
  const params = new URLSearchParams({ latest: "true" });
  if (type) params.set("type", type); if (actor) params.set("actor", actor);
  const log = useData<AuditRow[]>("/api/admin/audit?" + params, 15000);
  return (
    <div className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Audit log</h1><p>Append-only record of privileged actions with actor, time, reason and previous/new values.</p></div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Actor"><input value={actorInput} onChange={(e) => setActorInput(e.target.value)} placeholder="Handle or email" style={{ width: 200 }} /></Field>
          <Field label="Resource"><select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 220 }}>
            <option value="">All</option><option value="judging_settings">Judging settings</option><option value="worker">Workers</option><option value="run">Runs</option><option value="competition">Competitions</option><option value="submission">Submissions</option><option value="user">Users</option><option value="language">Languages</option><option value="problem">Problems</option></select></Field>
        </div></div>
      <ErrorBox error={log.error} />
      {log.loading ? <Loading /> : !log.data?.length ? <Empty>No entries.</Empty> : <AuditTable rows={log.data} />}
      <p className="small muted">Shows the newest 200 entries matching the filter.</p>
    </div>
  );
}
