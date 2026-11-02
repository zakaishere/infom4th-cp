package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import java.util.*;

/** SUPER_ADMIN view of every team: who is in it and what it played. Read-only; invite tokens are never returned. */
@Service
public class TeamAdminService {
    private final TeamRepository teams;private final StandingsService standings;
    public TeamAdminService(TeamRepository teams,StandingsService standings){this.teams=teams;this.standings=standings;}
    private static void requireSuperAdmin(Actor actor){Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator permission required");}

    public Map<String,Object> list(Actor actor,String q,String activity,int offset) {
        requireSuperAdmin(actor);Api.require(offset>=0,HttpStatus.BAD_REQUEST,"Invalid offset");
        String search=q==null||q.isBlank()?null:q.trim(),kind=activity==null||activity.isBlank()?null:activity;
        return Map.of("teams",teams.search(search,kind,offset),"total",teams.count(search,kind),"summary",teams.summary());
    }
    public Map<String,Object> detail(Actor actor,UUID id) {
        requireSuperAdmin(actor);
        var team=new LinkedHashMap<>(teams.overview(id));
        team.put("members",teams.members(id));
        var contests=teams.entries(id);addResults(contests);
        team.put("contests",contests);
        team.put("registrations",teams.pendingRegistrations(id));
        return team;
    }
    /**
     * Adds rank, solved, score and penalty from each run's jury board, which is never frozen, so these are
     * the true current results. All runs are loaded together rather than one scoreboard request per run.
     */
    private void addResults(List<Map<String,Object>> contests) {
        var inputs=standings.inputs(contests.stream().map(c->(UUID)c.get("run_id")).toList());
        for(var contest:contests) {
            var input=inputs.get((UUID)contest.get("run_id"));
            for(var row:standings.board(input,Api.time(contest.get("starts_at")),null).rows())if(row.entry().equals(contest.get("entry_id"))) {
                contest.put("rank",row.rank());contest.put("solved",row.solved());contest.put("score",row.score());contest.put("penalty_seconds",row.penaltySeconds());
            }
            contest.put("scoring",input.version().get("scoring_system"));
        }
    }
}
