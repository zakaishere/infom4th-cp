import { useState } from "react";
import { post } from "../api";
import { useAction, useAuth, useData } from "../app";
import { Badge, Empty, Field, Loading } from "../ui";

export default function Teams() {
  const { me } = useAuth();
  const teams = useData<{ id: string; name: string; captain_id: string; members: string | null; locked: boolean }[]>("/api/teams");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState<{ team: string; token: string } | null>(null);
  const { busy, run } = useAction();
  return (
    <main className="page">
      <div className="page-head"><div><div className="eyebrow">Team contests</div><h1>Teams</h1>
        <p>Create a team and share its invite code. The captain registers the team; membership locks while it is registered for a scheduled or running contest.</p></div></div>
      <div className="grid grid-2">
        <section className="card stack">
          <h3>Your teams</h3>
          {teams.loading ? <Loading /> : !teams.data?.length ? <Empty>You are not in a team yet.</Empty> : teams.data.map((t) => (
            <div key={t.id} className="row-between card-flat">
              <div><strong>{t.name}</strong> {t.captain_id === me?.id && <Badge tone="info">Captain</Badge>} {t.locked && <Badge tone="warn">Locked for a contest</Badge>}
                <div className="small muted">Members: {t.members}</div></div>
              {t.captain_id === me?.id && (
                <button className="small" disabled={busy} onClick={() => run(async () => {
                  const r = await post("/api/teams/" + t.id + "/invite");
                  setInvite({ team: t.name, token: r.inviteToken });
                })}>New invite code</button>
              )}
            </div>
          ))}
          {invite && (
            <div className="notice ok small">
              Invite code for <strong>{invite.team}</strong> (valid 7 days; replaces older codes):
              <pre className="mono">{invite.token}</pre>
            </div>
          )}
        </section>
        <section className="stack">
          <form className="card stack" onSubmit={(e) => {
            e.preventDefault();
            run(async () => { const r = await post("/api/teams", { name }); setInvite({ team: name, token: r.inviteToken }); setName(""); teams.reload(); }, "Team created");
          }}>
            <h3>Create a team</h3>
            <Field label="Team name"><input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div><button className="primary" disabled={busy}>Create</button></div>
          </form>
          <form className="card stack" onSubmit={(e) => {
            e.preventDefault();
            run(async () => { await post("/api/teams/join", { inviteToken: token.trim() }); setToken(""); teams.reload(); }, "Joined the team");
          }}>
            <h3>Join with an invite code</h3>
            <Field label="Invite code"><input required value={token} onChange={(e) => setToken(e.target.value)} className="mono" /></Field>
            <div><button disabled={busy}>Join</button></div>
          </form>
        </section>
      </div>
    </main>
  );
}
