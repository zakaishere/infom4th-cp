package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

/** SUPER_ADMIN view of every team: who is in it and what it played. Read-only; invite tokens are never returned. */
@RestController
public class TeamAdminController {
    private final Database db;private final StandingsService standings;
    public TeamAdminController(Database db,StandingsService standings){this.db=db;this.standings=standings;}
    private static Actor admin(Authentication authentication) {
        Actor actor=Actor.of(authentication);Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator permission required");return actor;
    }
    private static final String LOCKED=TeamRepository.LOCKED;
    private static final String PLAYED="EXISTS(SELECT 1 FROM run_entries e WHERE e.team_id=t.id)";
    private static final String FILTER=" WHERE (?::text IS NULL OR t.name ILIKE '%'||?::text||'%' OR EXISTS(SELECT 1 FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=t.id AND (u.handle ILIKE '%'||?::text||'%' OR u.email ILIKE '%'||?::text||'%')))"+
            " AND (?::text IS NULL OR (?::text='played' AND "+PLAYED+") OR (?::text='never' AND NOT "+PLAYED+") OR (?::text='locked' AND "+LOCKED+"))";

    /** q matches a team name or a member's handle or email; activity is played, never or locked. */
    @GetMapping("/api/admin/teams")
    Object list(Authentication auth,@RequestParam(defaultValue="0") int offset,@RequestParam(required=false) String q,@RequestParam(required=false) String activity) {
        admin(auth);Api.require(offset>=0,HttpStatus.BAD_REQUEST,"Invalid offset");
        String search=q==null||q.isBlank()?null:q.trim(),kind=activity==null||activity.isBlank()?null:activity;
        Object[] args={search,search,search,search,kind,kind,kind,kind};
        var all=new ArrayList<>(Arrays.asList(args));all.add(offset);
        var teams=db.jdbc.queryForList("SELECT t.id,t.name,t.created_at,cap.handle AS captain,cap.id AS captain_id,"+
                "(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=t.id) AS members,"+
                "(SELECT count(*) FROM team_members m WHERE m.team_id=t.id) AS member_count,"+
                "(SELECT count(*) FROM run_entries e JOIN contest_runs r ON r.id=e.run_id WHERE e.team_id=t.id AND r.kind='OFFICIAL') AS contests,"+
                "(SELECT count(*) FROM submissions s JOIN run_entries e ON e.id=s.entry_id WHERE e.team_id=t.id) AS submissions,"+
                "last.title AS last_contest,last.competition_id AS last_contest_id,last.starts_at AS last_played_at,"+LOCKED+" AS locked "+
                "FROM teams t JOIN users cap ON cap.id=t.captain_id "+
                "LEFT JOIN LATERAL (SELECT c.title,c.id AS competition_id,r.starts_at FROM run_entries e JOIN contest_runs r ON r.id=e.run_id JOIN competitions c ON c.id=r.competition_id WHERE e.team_id=t.id ORDER BY r.starts_at DESC LIMIT 1) last ON true"+
                FILTER+" ORDER BY last.starts_at DESC NULLS LAST,t.created_at DESC LIMIT 100 OFFSET ?",all.toArray());
        return Map.of("teams",teams,"total",db.jdbc.queryForObject("SELECT count(*) FROM teams t"+FILTER,Long.class,args),
                "summary",db.jdbc.queryForMap("SELECT count(*) AS teams,count(*) FILTER (WHERE "+PLAYED+") AS played,count(*) FILTER (WHERE "+LOCKED+") AS locked FROM teams t"));
    }

    @GetMapping("/api/admin/teams/{id}")
    Object detail(Authentication auth,@PathVariable UUID id) {
        Actor actor=admin(auth);
        var team=new LinkedHashMap<>(db.one("SELECT t.id,t.name,t.created_at,t.captain_id,cap.handle AS captain,"+LOCKED+" AS locked FROM teams t JOIN users cap ON cap.id=t.captain_id WHERE t.id=?",id));
        team.put("members",db.jdbc.queryForList("SELECT u.id,u.handle,u.display_name,u.status,m.joined_at,"+
                "(SELECT count(*) FROM submissions s JOIN run_entries e ON e.id=s.entry_id WHERE e.team_id=m.team_id AND s.submitted_by=u.id) AS submissions "+
                "FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY m.joined_at",id));
        // Members are a snapshot of who played that contest, which can differ from today's team.
        var contests=db.jdbc.queryForList("SELECT r.id AS run_id,r.kind,r.status,r.starts_at,r.ends_at,c.id AS competition_id,c.title,e.id AS entry_id,e.display_name,"+
                "(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM run_entry_members x JOIN users u ON u.id=x.user_id WHERE x.entry_id=e.id) AS members,"+
                "(SELECT count(*) FROM submissions s WHERE s.entry_id=e.id) AS submissions,"+
                "(SELECT count(*) FROM competition_problems p WHERE p.competition_version_id=r.competition_version_id) AS problems,"+
                "(SELECT count(*) FROM run_entries x WHERE x.run_id=r.id) AS entrants "+
                "FROM run_entries e JOIN contest_runs r ON r.id=e.run_id JOIN competitions c ON c.id=r.competition_id WHERE e.team_id=? ORDER BY r.starts_at DESC LIMIT 30",id);
        for(var contest:contests) {
            // The jury board is never frozen, so these are the true current results.
            @SuppressWarnings("unchecked") var board=(Map<String,Object>)standings.get(actor,(UUID)contest.get("run_id"),true);
            for(var row:(List<ContestScoring.Row>)board.get("standings"))if(row.entry().equals(contest.get("entry_id"))) {
                contest.put("rank",row.rank());contest.put("solved",row.solved());contest.put("score",row.score());contest.put("penalty_seconds",row.penaltySeconds());
            }
            contest.put("scoring",board.get("scoring"));
        }
        team.put("contests",contests);
        team.put("registrations",db.jdbc.queryForList("SELECT c.id AS competition_id,c.title,c.status AS competition_status,r.status,r.created_at FROM registrations r JOIN competitions c ON c.id=r.competition_id "+
                "WHERE r.team_id=? AND NOT EXISTS(SELECT 1 FROM contest_runs x JOIN run_entries e ON e.run_id=x.id WHERE x.competition_id=c.id AND e.team_id=r.team_id) ORDER BY r.created_at DESC LIMIT 30",id));
        return team;
    }
}
