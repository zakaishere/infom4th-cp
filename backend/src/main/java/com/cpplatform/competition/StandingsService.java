package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.time.Instant;

@Service
public class StandingsService {
    private record Cached(long until,Object value) {}
    private final ConcurrentHashMap<String,Cached> cache=new ConcurrentHashMap<>();
    private final Database db;private final CompetitionService contests;private final Permissions access;
    public StandingsService(Database db,CompetitionService contests,Permissions access){this.db=db;this.contests=contests;this.access=access;}
    public synchronized Object get(Actor actor,UUID run,boolean jury) {
        var r=contests.runAccess(actor,run,false);
        if(jury)Api.require(access.jury(actor,(UUID)r.get("competition_id")),HttpStatus.FORBIDDEN,"Jury access required");
        String key=run+":"+jury;long now=System.currentTimeMillis();
        Cached existing=cache.get(key);if(existing!=null && existing.until>now)return existing.value;
        var v=db.one("SELECT * FROM competition_versions WHERE id=?",r.get("competition_version_id"));
        long freezeSeconds=((Number)v.get("freeze_before_end_seconds")).longValue();
        Instant cutoff=(!jury && freezeSeconds>0 && r.get("final_standings_released_at")==null)?Api.time(r.get("ends_at")).minusSeconds(freezeSeconds):null;
        var input=input(run,v);
        var board=board(input,Api.time(r.get("starts_at")),cutoff);
        var result=new LinkedHashMap<String,Object>();
        result.put("scoring",v.get("scoring_system"));
        result.put("standings",board.rows());
        result.put("entries",input.entries());
        result.put("problems",input.problems().stream().map(p->Map.of("slot",p.get("slot"),"label",p.get("label"),"points",board.points().get(((Number)p.get("slot")).intValue()))).toList());
        result.put("problemStats",board.stats());
        result.put("frozen",cutoff!=null && !Instant.now().isBefore(cutoff));
        result.put("serverTime",Instant.now());
        if(cache.size()>200)cache.entrySet().removeIf(e->e.getValue().until<now);
        cache.put(key,new Cached(now+1000,result));return result;
    }

    /** Everything a board is calculated from, for callers that need the board more than once. */
    public record Input(Map<String,Object> version,List<Map<String,Object>> entries,List<Map<String,Object>> problems,List<Integer> slots,Map<Integer,Integer> points,List<ContestScoring.Submission> submissions) {}
    public Input input(UUID run,Map<String,Object> version) {
        var entries=db.jdbc.queryForList("SELECT e.id,e.display_name,(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM run_entry_members m JOIN users u ON u.id=m.user_id WHERE m.entry_id=e.id) AS members FROM run_entries e WHERE e.run_id=? ORDER BY e.id",run);
        var problems=db.jdbc.queryForList("SELECT slot,label,points FROM competition_problems WHERE competition_version_id=? ORDER BY slot",version.get("id"));
        List<Integer> slots=new ArrayList<>();Map<Integer,Integer> points=new HashMap<>();
        for(var p:problems){int slot=((Number)p.get("slot")).intValue();slots.add(slot);if(p.get("points")!=null)points.put(slot,((Number)p.get("points")).intValue());}
        var rows=db.jdbc.queryForList("SELECT s.id,s.entry_id,s.problem_slot,s.submitted_at,latest.verdict,latest.passed_tests,latest.total_tests FROM submissions s LEFT JOIN LATERAL (SELECT jr.verdict,jr.passed_tests,jr.total_tests FROM judging_jobs j JOIN judging_results jr ON jr.job_id=j.id WHERE j.submission_id=s.id AND j.status='COMPLETED' ORDER BY j.generation DESC LIMIT 1) latest ON true WHERE s.run_id=?",run);
        var submissions=rows.stream().map(s->new ContestScoring.Submission((UUID)s.get("id"),(UUID)s.get("entry_id"),((Number)s.get("problem_slot")).intValue(),Api.time(s.get("submitted_at")),(String)s.get("verdict"),
                s.get("passed_tests")==null?0:((Number)s.get("passed_tests")).intValue(),s.get("total_tests")==null?0:((Number)s.get("total_tests")).intValue())).toList();
        return new Input(version,entries,problems,slots,points,submissions);
    }
    public ContestScoring.Board board(Input in,Instant starts,Instant cutoff) {
        var v=in.version();
        return ContestScoring.calculate((String)v.get("scoring_system"),in.entries().stream().map(e->(UUID)e.get("id")).toList(),in.slots(),in.points(),in.submissions(),
                starts,cutoff,((Number)v.get("wrong_attempt_penalty_seconds")).longValue(),Boolean.TRUE.equals(v.get("penalize_compilation_errors")));
    }
}
