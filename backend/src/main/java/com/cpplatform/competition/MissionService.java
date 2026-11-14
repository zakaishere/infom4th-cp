package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.*;

/**
 * Missions: a TP made of practice problems with points. Participants solve them through the practice
 * routes. Score of a problem = weight x (tests passed / total tests) of the best submission, so a retry
 * can only raise it; attempts are counted and shown but never cost points. Only real submissions made
 * while the mission is open count (no "run examples"), and staff are left off the board because they can
 * read the hidden tests. Ranking: points, then fewer attempts, then who reached the score first.
 */
@Service
public class MissionService {
    private final Database db;private final Permissions access;
    public MissionService(Database db,Permissions access){this.db=db;this.access=access;}

    /** Every counted submission of the mission with its latest completed verdict (null while queued). */
    private static final String SUBMISSIONS="SELECT s.submitted_by AS user_id,u.handle,u.display_name,mp.problem_id,s.submitted_at,r.verdict,r.passed_tests,r.total_tests "
            +"FROM missions m JOIN mission_problems mp ON mp.mission_id=m.id JOIN problem_versions v ON v.problem_id=mp.problem_id "
            +"JOIN submissions s ON s.problem_version_id=v.id AND s.context='PRACTICE' AND NOT s.samples_only AND s.submitted_at>=m.opens_at AND (m.closes_at IS NULL OR s.submitted_at<m.closes_at) "
            +"JOIN users u ON u.id=s.submitted_by AND u.status='ACTIVE' "
            +"LEFT JOIN LATERAL (SELECT jr.verdict,jr.passed_tests,jr.total_tests FROM judging_jobs j JOIN judging_results jr ON jr.job_id=j.id WHERE j.submission_id=s.id AND j.status='COMPLETED' ORDER BY j.generation DESC LIMIT 1) r ON true "
            +"WHERE m.id=? AND NOT EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=s.submitted_by AND ur.role_code IN ('SUPER_ADMIN','ADMIN','MODERATOR')) ORDER BY s.submitted_at";

    static final class Cell {int attempts,passed,total;Instant firstOk,bestAt;boolean accepted;}
    static final class Player {
        UUID id;String handle,name;final Map<UUID,Cell> cells=new HashMap<>();
        double points;int solved,attempts;Instant reachedAt;int rank;
    }

    private Map<String,Object> mission(String slug) {
        var rows=db.jdbc.queryForList("SELECT id,slug,title,description,opens_at,closes_at,created_at,(closes_at IS NULL OR closes_at>now()) AS open FROM missions WHERE slug=?",slug);
        Api.require(!rows.isEmpty(),HttpStatus.NOT_FOUND,"Mission not found");
        return rows.get(0);
    }
    private List<Map<String,Object>> problems(UUID mission) {
        return db.jdbc.queryForList("SELECT mp.problem_id,mp.position,mp.weight,pp.problem_version_id AS id,v.title,v.difficulty FROM mission_problems mp "
                +"JOIN practice_publications pp ON pp.problem_id=mp.problem_id JOIN problem_versions v ON v.id=pp.problem_version_id WHERE mp.mission_id=? AND NOT pp.hidden ORDER BY mp.position,v.title",mission);
    }
    private static double weight(Object value){return ((Number)value).doubleValue();}
    private static double round(double value){return BigDecimal.valueOf(value).setScale(2,RoundingMode.HALF_UP).doubleValue();}

    /** Scores every participant of the mission, ranked. */
    private List<Player> board(UUID mission,List<Map<String,Object>> problems) {
        var weights=new HashMap<UUID,Double>();
        for(var p:problems)weights.put((UUID)p.get("problem_id"),weight(p.get("weight")));
        var players=new LinkedHashMap<UUID,Player>();
        for(var row:db.jdbc.queryForList(SUBMISSIONS,mission)) {
            UUID user=(UUID)row.get("user_id"),problem=(UUID)row.get("problem_id");
            if(!weights.containsKey(problem))continue;
            var player=players.computeIfAbsent(user,k->{var x=new Player();x.id=user;x.handle=(String)row.get("handle");x.name=(String)row.get("display_name");return x;});
            var cell=player.cells.computeIfAbsent(problem,k->new Cell());
            cell.attempts++;
            if(row.get("total_tests")==null)continue;
            Instant at=((java.sql.Timestamp)row.get("submitted_at")).toInstant();
            int passed="COMPILATION_ERROR".equals(row.get("verdict"))?0:((Number)row.get("passed_tests")).intValue(),total=((Number)row.get("total_tests")).intValue();
            // A strictly better submission replaces the best; the first one to reach it keeps the time.
            if(cell.total==0 || passed*cell.total>cell.passed*total){cell.passed=passed;cell.total=total;cell.bestAt=at;}
            if("ACCEPTED".equals(row.get("verdict"))){cell.accepted=true;if(cell.firstOk==null)cell.firstOk=at;}
        }
        for(var player:players.values()) {
            for(var entry:player.cells.entrySet()) {
                var cell=entry.getValue();player.attempts+=cell.attempts;
                if(cell.total>0)player.points+=weights.get(entry.getKey())*cell.passed/cell.total;
                if(cell.accepted)player.solved++;
                if(cell.bestAt!=null && cell.passed>0 && (player.reachedAt==null || cell.bestAt.isAfter(player.reachedAt)))player.reachedAt=cell.bestAt;
            }
            player.points=round(player.points);
        }
        var ranked=new ArrayList<>(players.values());
        ranked.sort(Comparator.<Player>comparingDouble(p->-p.points).thenComparingInt(p->p.attempts)
                .thenComparing(p->p.reachedAt==null?Instant.MAX:p.reachedAt).thenComparing(p->p.handle.toLowerCase()));
        for(int i=0;i<ranked.size();i++)ranked.get(i).rank=i+1;
        return ranked;
    }

    private Map<String,Object> card(Player player,List<Map<String,Object>> problems) {
        var rows=new ArrayList<Map<String,Object>>();
        for(var p:problems) {
            var cell=player==null?null:player.cells.get((UUID)p.get("problem_id"));
            var row=new LinkedHashMap<String,Object>();
            row.put("problemId",p.get("problem_id"));row.put("version",p.get("id"));row.put("title",p.get("title"));row.put("weight",weight(p.get("weight")));
            row.put("points",cell==null||cell.total==0?0:round(weight(p.get("weight"))*cell.passed/cell.total));row.put("attempts",cell==null?0:cell.attempts);
            row.put("passed",cell==null?0:cell.passed);row.put("total",cell==null?0:cell.total);row.put("solved",cell!=null&&cell.accepted);
            row.put("firstSolvedAt",cell==null?null:cell.firstOk);
            rows.add(row);
        }
        var card=new LinkedHashMap<String,Object>();
        if(player!=null){card.put("handle",player.handle);card.put("name",player.name);card.put("rank",player.rank);}
        card.put("points",player==null?0:player.points);card.put("solved",player==null?0:player.solved);card.put("attempts",player==null?0:player.attempts);
        card.put("lastProgressAt",player==null?null:player.reachedAt);card.put("problems",rows);
        return card;
    }

    public List<Map<String,Object>> list(Actor actor) {
        var result=new ArrayList<Map<String,Object>>();
        for(var m:db.jdbc.queryForList("SELECT id,slug,title,description,opens_at,closes_at,(closes_at IS NULL OR closes_at>now()) AS open FROM missions ORDER BY created_at DESC")) {
            var problems=problems((UUID)m.get("id"));
            var players=board((UUID)m.get("id"),problems);
            var item=new LinkedHashMap<String,Object>(m);item.remove("id");
            item.put("problems",problems.size());item.put("totalPoints",problems.stream().mapToDouble(p->weight(p.get("weight"))).sum());item.put("participants",players.size());
            players.stream().filter(p->p.id.equals(actor.id())).findFirst().ifPresent(p->{item.put("myPoints",p.points);item.put("myRank",p.rank);item.put("mySolved",p.solved);});
            result.add(item);
        }
        return result;
    }

    public Map<String,Object> detail(Actor actor,String slug) {
        var m=mission(slug);UUID id=(UUID)m.get("id");
        var problems=problems(id);var players=board(id,problems);
        var mine=players.stream().filter(p->p.id.equals(actor.id())).findFirst().orElse(null);
        var leaderboard=new ArrayList<Map<String,Object>>();
        for(var p:players.stream().limit(200).toList())
            leaderboard.add(Map.of("rank",p.rank,"handle",p.handle,"name",p.name,"points",p.points,"solved",p.solved,"attempts",p.attempts,"me",p.id.equals(actor.id())));
        var result=new LinkedHashMap<String,Object>(m);result.remove("id");
        result.put("totalPoints",problems.stream().mapToDouble(p->weight(p.get("weight"))).sum());result.put("participants",players.size());
        result.put("me",card(mine,problems));result.put("leaderboard",leaderboard);
        return result;
    }

    /** Score card of any participant: the same card they see themselves, readable by every signed-in member. */
    public Map<String,Object> card(String slug,String handle) {
        var m=mission(slug);UUID id=(UUID)m.get("id");
        var problems=problems(id);var players=board(id,problems);
        var player=players.stream().filter(p->p.handle.equalsIgnoreCase(handle)).findFirst().orElse(null);
        Api.require(player!=null,HttpStatus.NOT_FOUND,"No score for this participant in this mission");
        var result=new LinkedHashMap<String,Object>();
        result.put("mission",Map.of("slug",m.get("slug"),"title",m.get("title"),"totalPoints",problems.stream().mapToDouble(p->weight(p.get("weight"))).sum(),"participants",players.size()));
        result.put("card",card(player,problems));
        return result;
    }

    /** Organizer: open or close the mission, restart its window, edit title and description, and set the points of each problem. */
    @Transactional
    public void update(Actor actor,String slug,Map<String,Object> body) {
        access.organizer(actor);
        var m=mission(slug);UUID id=(UUID)m.get("id");
        if(body.containsKey("title"))db.jdbc.update("UPDATE missions SET title=? WHERE id=?",Api.text(body,"title",120),id);
        if(body.containsKey("description"))db.jdbc.update("UPDATE missions SET description=? WHERE id=?",Api.optional(body,"description","",4000),id);
        if(body.containsKey("open")) {
            if(Boolean.TRUE.equals(body.get("open")))db.jdbc.update("UPDATE missions SET closes_at=NULL WHERE id=?",id);
            else db.jdbc.update("UPDATE missions SET closes_at=greatest(now(),opens_at+interval '1 second') WHERE id=?",id);
        }
        // Restarts the counted window now: earlier submissions stop counting (a fresh session of the same TP).
        if(Boolean.TRUE.equals(body.get("restart")))db.jdbc.update("UPDATE missions SET opens_at=now(),closes_at=NULL WHERE id=?",id);
        if(body.get("weights") instanceof Map<?,?> weights)for(var e:weights.entrySet()) {
            Api.require(e.getValue() instanceof Number n && n.doubleValue()>0 && n.doubleValue()<=1000,HttpStatus.BAD_REQUEST,"Points must be between 0 and 1000");
            db.jdbc.update("UPDATE mission_problems SET weight=? WHERE mission_id=? AND problem_id=?::uuid",((Number)e.getValue()).doubleValue(),id,String.valueOf(e.getKey()));
        }
        db.audit(actor.id(),"MISSION_UPDATE","mission",id,Api.optional(body,"reason","Mission settings",2000));
    }
}
