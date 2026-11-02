package com.cpplatform.competition;

import com.cpplatform.common.*;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
class TeamRepository {
    /** A team is locked while it holds an approved registration for a scheduled or running contest. Expects the team aliased as t. */
    static final String LOCKED="EXISTS(SELECT 1 FROM registrations r JOIN competitions c ON c.id=r.competition_id WHERE r.team_id=t.id AND r.status='APPROVED' AND c.status IN ('SCHEDULED','RUNNING'))";
    private static final String PLAYED="EXISTS(SELECT 1 FROM run_entries e WHERE e.team_id=t.id)";
    /** q matches a team name or a member's handle or email; activity is played, never or locked. Both may be null. */
    private static final String FILTER=" WHERE (?::text IS NULL OR t.name ILIKE '%'||?::text||'%' OR EXISTS(SELECT 1 FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=t.id AND (u.handle ILIKE '%'||?::text||'%' OR u.email ILIKE '%'||?::text||'%')))"+
            " AND (?::text IS NULL OR (?::text='played' AND "+PLAYED+") OR (?::text='never' AND NOT "+PLAYED+") OR (?::text='locked' AND "+LOCKED+"))";
    private static Object[] filter(String q,String activity){return new Object[]{q,q,q,q,activity,activity,activity,activity};}
    private final Database db;
    TeamRepository(Database db){this.db=db;}

    List<Map<String,Object>> search(String q,String activity,int offset) {
        var args=new ArrayList<>(Arrays.asList(filter(q,activity)));args.add(offset);
        return db.jdbc.queryForList("SELECT t.id,t.name,t.created_at,cap.handle AS captain,cap.id AS captain_id,"+
                "(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=t.id) AS members,"+
                "(SELECT count(*) FROM team_members m WHERE m.team_id=t.id) AS member_count,"+
                "(SELECT count(*) FROM run_entries e JOIN contest_runs r ON r.id=e.run_id WHERE e.team_id=t.id AND r.kind='OFFICIAL') AS contests,"+
                "(SELECT count(*) FROM submissions s JOIN run_entries e ON e.id=s.entry_id WHERE e.team_id=t.id) AS submissions,"+
                "last.title AS last_contest,last.competition_id AS last_contest_id,last.starts_at AS last_played_at,"+LOCKED+" AS locked "+
                "FROM teams t JOIN users cap ON cap.id=t.captain_id "+
                "LEFT JOIN LATERAL (SELECT c.title,c.id AS competition_id,r.starts_at FROM run_entries e JOIN contest_runs r ON r.id=e.run_id JOIN competitions c ON c.id=r.competition_id WHERE e.team_id=t.id ORDER BY r.starts_at DESC LIMIT 1) last ON true"+
                FILTER+" ORDER BY last.starts_at DESC NULLS LAST,t.created_at DESC LIMIT 100 OFFSET ?",args.toArray());
    }
    long count(String q,String activity){return db.jdbc.queryForObject("SELECT count(*) FROM teams t"+FILTER,Long.class,filter(q,activity));}
    Map<String,Object> summary(){return db.jdbc.queryForMap("SELECT count(*) AS teams,count(*) FILTER (WHERE "+PLAYED+") AS played,count(*) FILTER (WHERE "+LOCKED+") AS locked FROM teams t");}
    Map<String,Object> overview(UUID team){return db.one("SELECT t.id,t.name,t.created_at,t.captain_id,cap.handle AS captain,"+LOCKED+" AS locked FROM teams t JOIN users cap ON cap.id=t.captain_id WHERE t.id=?",team);}
    List<Map<String,Object>> members(UUID team) {
        return db.jdbc.queryForList("SELECT u.id,u.handle,u.display_name,u.status,m.joined_at,"+
                "(SELECT count(*) FROM submissions s JOIN run_entries e ON e.id=s.entry_id WHERE e.team_id=m.team_id AND s.submitted_by=u.id) AS submissions "+
                "FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY m.joined_at",team);
    }
    /** The latest 30 runs the team entered. Members are a snapshot of who played that contest, which can differ from today's team. */
    List<Map<String,Object>> entries(UUID team) {
        return db.jdbc.queryForList("SELECT r.id AS run_id,r.kind,r.status,r.starts_at,r.ends_at,c.id AS competition_id,c.title,e.id AS entry_id,e.display_name,"+
                "(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM run_entry_members x JOIN users u ON u.id=x.user_id WHERE x.entry_id=e.id) AS members,"+
                "(SELECT count(*) FROM submissions s WHERE s.entry_id=e.id) AS submissions,"+
                "(SELECT count(*) FROM competition_problems p WHERE p.competition_version_id=r.competition_version_id) AS problems,"+
                "(SELECT count(*) FROM run_entries x WHERE x.run_id=r.id) AS entrants "+
                "FROM run_entries e JOIN contest_runs r ON r.id=e.run_id JOIN competitions c ON c.id=r.competition_id WHERE e.team_id=? ORDER BY r.starts_at DESC LIMIT 30",team);
    }
    /** Registrations for competitions the team has not played yet. */
    List<Map<String,Object>> pendingRegistrations(UUID team) {
        return db.jdbc.queryForList("SELECT c.id AS competition_id,c.title,c.status AS competition_status,r.status,r.created_at FROM registrations r JOIN competitions c ON c.id=r.competition_id "+
                "WHERE r.team_id=? AND NOT EXISTS(SELECT 1 FROM contest_runs x JOIN run_entries e ON e.run_id=x.id WHERE x.competition_id=c.id AND e.team_id=r.team_id) ORDER BY r.created_at DESC LIMIT 30",team);
    }

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
