package com.cpplatform.competition;

import com.cpplatform.common.*;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
class TeamRepository {
    /** A team is locked while it holds an approved registration for a scheduled or running contest. Expects the team aliased as t. */
    static final String LOCKED="EXISTS(SELECT 1 FROM registrations r JOIN competitions c ON c.id=r.competition_id WHERE r.team_id=t.id AND r.status='APPROVED' AND c.status IN ('SCHEDULED','RUNNING'))";
    private final Database db;
    TeamRepository(Database db){this.db=db;}

    UUID create(String name,UUID captain){return db.id("INSERT INTO teams(name,captain_id) VALUES (?,?) RETURNING id",name,captain);}
    void addMember(UUID team,UUID user){db.jdbc.update("INSERT INTO team_members(team_id,user_id) VALUES (?,?)",team,user);}
    /** Locks the team row for the rest of the transaction and returns its captain. */
    UUID lockForUpdate(UUID team){return (UUID)db.one("SELECT captain_id FROM teams WHERE id=? FOR UPDATE",team).get("captain_id");}
    boolean locked(UUID team){return db.exists("SELECT "+LOCKED+" FROM teams t WHERE t.id=?",team);}
    long memberCount(UUID team){return db.jdbc.queryForObject("SELECT count(*) FROM team_members WHERE team_id=?",Long.class,team);}
    /** Invites are single per team: a new one replaces the old. */
    void replaceInvite(UUID team,String digest) {
        db.jdbc.update("DELETE FROM team_invites WHERE team_id=?",team);
        db.jdbc.update("INSERT INTO team_invites VALUES (?,?,now()+interval '7 days')",digest,team);
    }
    UUID teamForInvite(String digest){return (UUID)db.one("SELECT team_id FROM team_invites WHERE token_digest=? AND expires_at>now()",digest).get("team_id");}
    // Members and whether the team is locked by a scheduled or running registration.
    List<Map<String,Object>> forMember(UUID user) {
        return db.jdbc.queryForList("SELECT t.id,t.name,t.captain_id,(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM team_members x JOIN users u ON u.id=x.user_id WHERE x.team_id=t.id) AS members,"
                +LOCKED+" AS locked FROM teams t JOIN team_members m ON m.team_id=t.id WHERE m.user_id=?",user);
    }
}
