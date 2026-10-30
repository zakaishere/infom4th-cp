package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;

/**
 * Player and team profiles, head-to-head and rivals. Every signed-in user can read these, so they are
 * built only from public results: never email, source code, private contests or a running contest.
 */
@Service
public class ProfileService {
    private static final String STAFF="EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role_code IN ('SUPER_ADMIN','ADMIN','MODERATOR'))";
    private static final String COUNTED_SUBMISSIONS="SELECT s.submitted_at,s.language_code,v.problem_id,v.title,v.difficulty,latest.verdict,latest.execution_time_ms,latest.peak_memory_kb FROM submissions s "
            +"JOIN problem_versions v ON v.id=s.problem_version_id "+LeaderboardService.COUNTED_JOINS
            +"LEFT JOIN LATERAL (SELECT jr.verdict,jr.execution_time_ms,jr.peak_memory_kb FROM judging_jobs j JOIN judging_results jr ON jr.job_id=j.id WHERE j.submission_id=s.id AND j.status='COMPLETED' ORDER BY j.generation DESC LIMIT 1) latest ON true "
            +"WHERE s.submitted_by=? AND "+LeaderboardService.COUNTED;
    private static final String CONTEST_COLUMNS="r.id AS run_id,c.title,r.starts_at,cv.scoring_system,cv.mode,c.rated,cr.entry_id,cr.rank,cr.entrants,cr.solved,cr.score,cr.penalty_seconds,e.display_name AS entry_name,e.team_id ";
    private static final int MAX_RIVALS=10;

    private final Database db;private final LeaderboardService leaderboard;private final ContestResults results;private final ZoneId zone;
    public ProfileService(Database db,LeaderboardService leaderboard,ContestResults results,@Value("${cp.display-timezone:UTC}") String zone) {
        this.db=db;this.leaderboard=leaderboard;this.results=results;this.zone=ZoneId.of(zone);
    }

    private Map<String,Object> user(String handle) {
        var rows=db.jdbc.queryForList("SELECT u.id,u.handle,u.display_name,u.bio,u.school,u.country,u.github,u.codeforces,u.created_at,"+STAFF+" AS staff FROM users u WHERE lower(u.handle)=lower(?) AND u.status='ACTIVE'",handle);
        Api.require(!rows.isEmpty(),HttpStatus.NOT_FOUND,"Player not found");
        return rows.get(0);
    }
    private List<ProfileStats.Sub> submissions(UUID user) {
        return db.jdbc.queryForList(COUNTED_SUBMISSIONS,user).stream().map(s->new ProfileStats.Sub(Api.time(s.get("submitted_at")),(String)s.get("language_code"),(UUID)s.get("problem_id"),(String)s.get("title"),(String)s.get("difficulty"),
                (String)s.get("verdict"),s.get("execution_time_ms")==null?null:((Number)s.get("execution_time_ms")).longValue(),s.get("peak_memory_kb")==null?null:((Number)s.get("peak_memory_kb")).longValue())).toList();
    }
    private Map<String,Object> summary(Map<String,Object> user) {
        UUID id=(UUID)user.get("id");
        var out=new LinkedHashMap<String,Object>();
        out.put("handle",user.get("handle"));out.put("display_name",user.get("display_name"));
        var place=leaderboard.player(id);
        out.put("sigma",place==null?null:place.get("score"));out.put("rank",place==null?null:place.get("rank"));out.put("tier",place==null?null:place.get("tier"));out.put("solved",place==null?0:place.get("solved"));
        out.put("rating",results.rating(id));
        return out;
    }

    public Map<String,Object> profile(Actor actor,String handle) {
        var user=user(handle);UUID id=(UUID)user.get("id");boolean own=id.equals(actor.id());
        var out=new LinkedHashMap<String,Object>();
        user.remove("id");out.put("user",user);out.put("own",own);
        out.put("isRival",db.exists("SELECT EXISTS(SELECT 1 FROM rivals WHERE user_id=? AND rival_id=?)",actor.id(),id));
        var place=leaderboard.player(id);
        out.put("sigma",place);out.put("playerCount",leaderboard.playerCount());
        var submissions=submissions(id);
        var stats=ProfileStats.calculate(submissions,zone,Instant.now());
        out.put("stats",stats);
        out.put("skills",skills(submissions,own,out));
        var history=results.ratings().getOrDefault(id,List.of());
        out.put("rating",history.isEmpty()?null:history.get(history.size()-1).rating());
        out.put("provisional",history.size()<Rating.PROVISIONAL_CONTESTS);
        out.put("ratingHistory",history.stream().map(p->Map.of("run_id",p.run(),"title",p.title(),"at",p.at(),"rating",p.rating(),"delta",p.delta(),"rank",p.rank(),"entrants",p.entrants())).toList());
        var contests=db.jdbc.queryForList("SELECT "+CONTEST_COLUMNS+"FROM contest_results cr "+ContestResults.RUN_JOINS+"JOIN run_entries e ON e.id=cr.entry_id JOIN run_entry_members m ON m.entry_id=cr.entry_id WHERE m.user_id=? AND "+ContestResults.PUBLIC_FINAL+" ORDER BY r.starts_at DESC LIMIT 100",id);
        for(var p:history)for(var c:contests)if(p.run().equals(c.get("run_id")))c.put("delta",p.delta());
        for(var c:contests)c.remove("entry_id");
        out.put("contests",contests);
        out.put("medals",db.jdbc.queryForMap("SELECT count(*) FILTER (WHERE cr.rank=1) AS gold,count(*) FILTER (WHERE cr.rank=2) AS silver,count(*) FILTER (WHERE cr.rank=3) AS bronze FROM contest_results cr "+ContestResults.RUN_JOINS
                +"JOIN run_entry_members m ON m.entry_id=cr.entry_id WHERE m.user_id=? AND cr.score>0 AND "+ContestResults.PUBLIC_FINAL,id));
        out.put("badges",badges(id,submissions));
        out.put("teams",db.jdbc.queryForList("SELECT t.id,t.name FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.user_id=? ORDER BY t.name",id));
        out.put("playedWith",db.jdbc.queryForList("SELECT u.handle,u.display_name,count(*) AS contests FROM contest_results cr "+ContestResults.RUN_JOINS
                +"JOIN run_entry_members me ON me.entry_id=cr.entry_id AND me.user_id=? JOIN run_entry_members o ON o.entry_id=cr.entry_id AND o.user_id<>me.user_id JOIN users u ON u.id=o.user_id AND u.status='ACTIVE' "
                +"WHERE "+ContestResults.PUBLIC_FINAL+" GROUP BY u.handle,u.display_name ORDER BY contests DESC,u.handle LIMIT 8",id));
        return out;
    }

    /** Coverage of the six largest practice tags and, on your own profile, the easiest unsolved problem in your weakest one. */
    private List<Map<String,Object>> skills(List<ProfileStats.Sub> submissions,boolean own,Map<String,Object> out) {
        Set<UUID> solved=new HashSet<>();
        for(var s:submissions)if("ACCEPTED".equals(s.verdict()))solved.add(s.problem());
        var catalog=db.jdbc.queryForList("SELECT unnest(pp.tags) AS tag,pp.problem_id,pp.problem_version_id,v.title,v.difficulty FROM practice_publications pp JOIN problem_versions v ON v.id=pp.problem_version_id WHERE NOT pp.hidden");
        Map<String,List<Map<String,Object>>> byTag=new TreeMap<>();
        for(var row:catalog)byTag.computeIfAbsent((String)row.get("tag"),k->new ArrayList<>()).add(row);
        List<Map<String,Object>> skills=new ArrayList<>();
        byTag.entrySet().stream().sorted(Comparator.<Map.Entry<String,List<Map<String,Object>>>>comparingInt(e->-e.getValue().size()).thenComparing(Map.Entry::getKey)).limit(6).forEach(e->{
            var skill=new LinkedHashMap<String,Object>();
            skill.put("tag",e.getKey());skill.put("total",e.getValue().size());
            skill.put("solved",e.getValue().stream().filter(p->solved.contains(p.get("problem_id"))).count());
            skills.add(skill);
        });
        if(own) {
            List<String> order=List.of("EASY","MEDIUM","HARD");
            skills.stream().sorted(Comparator.comparingDouble(s->((Number)s.get("solved")).doubleValue()/((Number)s.get("total")).doubleValue())).map(s->(String)s.get("tag"))
                    .map(tag->byTag.get(tag).stream().filter(p->!solved.contains(p.get("problem_id"))).min(Comparator.comparingInt(p->order.indexOf(p.get("difficulty")))).map(p->Map.of("tag",tag,"title",p.get("title"),"version_id",p.get("problem_version_id"))))
                    .flatMap(Optional::stream).findFirst().ifPresent(next->out.put("nextProblem",next));
        }
        return skills;
    }

    private List<Map<String,Object>> badges(UUID id,List<ProfileStats.Sub> submissions) {
        var earned=db.jdbc.queryForMap("SELECT coalesce(sum(cr.first_bloods),0) AS first_blood,count(*) FILTER (WHERE cr.clean_sheet) AS clean_sheet,count(*) FILTER (WHERE cr.buzzer_beater) AS buzzer_beater,count(*) FILTER (WHERE cr.freeze_breaker) AS freeze_breaker "
                +"FROM contest_results cr "+ContestResults.RUN_JOINS+"JOIN run_entry_members m ON m.entry_id=cr.entry_id WHERE m.user_id=? AND "+ContestResults.PUBLIC_FINAL,id);
        int languages=ProfileStats.acceptedLanguages(submissions),streak=ProfileStats.bestFirstTryStreak(submissions);
        return List.of(
                badge("first_blood","First Blood","First accepted solution on a problem in a contest",((Number)earned.get("first_blood")).longValue()),
                badge("clean_sheet","Clean Sheet","Every problem of a contest (3 or more) solved with no wrong attempts",((Number)earned.get("clean_sheet")).longValue()),
                badge("buzzer_beater","Buzzer Beater","Accepted in the final 60 seconds of a contest",((Number)earned.get("buzzer_beater")).longValue()),
                badge("freeze_breaker","Freeze Breaker","Climbed the most places after the scoreboard froze",((Number)earned.get("freeze_breaker")).longValue()),
                badge("polyglot","Polyglot","Accepted solutions in "+ProfileStats.POLYGLOT_LANGUAGES+" or more languages",languages>=ProfileStats.POLYGLOT_LANGUAGES?1:0),
                badge("sniper","Sniper",ProfileStats.SNIPER_STREAK+" problems in a row solved on the first try",streak>=ProfileStats.SNIPER_STREAK?1:0));
    }
    private static Map<String,Object> badge(String code,String name,String description,long count) {
        return Map.of("code",code,"name",name,"description",description,"count",count);
    }

    /** Who finished ahead in the contests both played, and what each solved that the other has not. */
    public Map<String,Object> headToHead(String first,String second) {
        var a=user(first);var b=user(second);UUID ida=(UUID)a.get("id"),idb=(UUID)b.get("id");
        Api.require(!ida.equals(idb),HttpStatus.BAD_REQUEST,"Choose two different players");
        var shared=db.jdbc.queryForList("SELECT r.id AS run_id,c.title,r.starts_at,ca.rank AS a_rank,cb.rank AS b_rank,ca.entrants,ca.entry_id=cb.entry_id AS teammates FROM contest_results ca "
                +"JOIN contest_results cb ON cb.run_id=ca.run_id JOIN run_entry_members ma ON ma.entry_id=ca.entry_id AND ma.user_id=? JOIN run_entry_members mb ON mb.entry_id=cb.entry_id AND mb.user_id=? "
                +"JOIN contest_runs r ON r.id=ca.run_id JOIN competitions c ON c.id=r.competition_id JOIN competition_versions cv ON cv.id=r.competition_version_id WHERE "+ContestResults.PUBLIC_FINAL+" ORDER BY r.starts_at DESC",ida,idb);
        int winsA=0,winsB=0,draws=0,teammates=0;
        for(var row:shared) {
            if(Boolean.TRUE.equals(row.get("teammates"))){teammates++;continue;}
            int ra=((Number)row.get("a_rank")).intValue(),rb=((Number)row.get("b_rank")).intValue();
            if(ra<rb)winsA++;else if(rb<ra)winsB++;else draws++;
        }
        Map<UUID,Object> practice=new HashMap<>();
        for(var p:db.jdbc.queryForList("SELECT problem_id,problem_version_id FROM practice_publications WHERE NOT hidden"))practice.put((UUID)p.get("problem_id"),p.get("problem_version_id"));
        var solvedA=solved(submissions(ida));var solvedB=solved(submissions(idb));
        var out=new LinkedHashMap<String,Object>();
        out.put("a",summary(a));out.put("b",summary(b));
        out.put("record",Map.of("a",winsA,"b",winsB,"draws",draws,"teammates",teammates));
        out.put("contests",shared);
        out.put("both",solvedA.keySet().stream().filter(solvedB::containsKey).count());
        out.put("onlyA",only(solvedA,solvedB,practice));out.put("onlyB",only(solvedB,solvedA,practice));
        return out;
    }
    private static Map<UUID,ProfileStats.Sub> solved(List<ProfileStats.Sub> submissions) {
        Map<UUID,ProfileStats.Sub> solved=new LinkedHashMap<>();
        for(var s:submissions)if("ACCEPTED".equals(s.verdict()))solved.putIfAbsent(s.problem(),s);
        return solved;
    }
    /** Practice problems come first because they are the ones you can open and solve right now. */
    private static List<Map<String,Object>> only(Map<UUID,ProfileStats.Sub> mine,Map<UUID,ProfileStats.Sub> theirs,Map<UUID,Object> practice) {
        return mine.entrySet().stream().filter(e->!theirs.containsKey(e.getKey())).sorted(Comparator.comparing(e->!practice.containsKey(e.getKey()))).limit(20).map(e->{
            var row=new LinkedHashMap<String,Object>();
            row.put("title",e.getValue().title());row.put("difficulty",e.getValue().difficulty());row.put("version_id",practice.get(e.getKey()));
            return (Map<String,Object>)row;
        }).toList();
    }

    @Transactional
    public void update(Actor actor,Map<String,Object> body) {
        String bio=Api.optional(body,"bio","",280).trim(),school=Api.optional(body,"school","",100).trim();
        String country=blank(Api.optional(body,"country","",2)),github=blank(Api.optional(body,"github","",39)),codeforces=blank(Api.optional(body,"codeforces","",24));
        Api.require(country==null || country.matches("[A-Z]{2}"),HttpStatus.BAD_REQUEST,"Country must be a two-letter code such as MA");
        Api.require(github==null || github.matches("[A-Za-z0-9](-?[A-Za-z0-9])*"),HttpStatus.BAD_REQUEST,"That is not a valid GitHub username");
        Api.require(codeforces==null || codeforces.matches("[A-Za-z0-9_.-]{3,24}"),HttpStatus.BAD_REQUEST,"That is not a valid Codeforces handle");
        db.jdbc.update("UPDATE users SET bio=?,school=?,country=?,github=?,codeforces=?,updated_at=now() WHERE id=?",bio,school,country,github,codeforces,actor.id());
    }
    private static String blank(String value){return value.isBlank()?null:value.trim();}

    public List<Map<String,Object>> rivals(Actor actor) {
        List<Map<String,Object>> out=new ArrayList<>();
        for(var user:db.jdbc.queryForList("SELECT u.id,u.handle,u.display_name FROM rivals x JOIN users u ON u.id=x.rival_id AND u.status='ACTIVE' WHERE x.user_id=? ORDER BY x.created_at",actor.id()))out.add(summary(user));
        return out;
    }
    /** Handles alone: the live scoreboard asks for this, so it must not touch anything expensive. */
    public List<String> rivalHandles(Actor actor) {
        return db.jdbc.queryForList("SELECT u.handle FROM rivals x JOIN users u ON u.id=x.rival_id WHERE x.user_id=?",String.class,actor.id());
    }
    @Transactional
    public void addRival(Actor actor,String handle) {
        db.one("SELECT id FROM users WHERE id=? FOR UPDATE",actor.id());
        UUID rival=(UUID)user(handle).get("id");
        Api.require(!rival.equals(actor.id()),HttpStatus.BAD_REQUEST,"You cannot be your own rival");
        long count=db.jdbc.queryForObject("SELECT count(*) FROM rivals WHERE user_id=?",Long.class,actor.id());
        Api.require(count<MAX_RIVALS,HttpStatus.CONFLICT,"You can pin at most "+MAX_RIVALS+" rivals");
        db.jdbc.update("INSERT INTO rivals(user_id,rival_id) VALUES (?,?) ON CONFLICT DO NOTHING",actor.id(),rival);
    }
    public void removeRival(Actor actor,String handle) {
        db.jdbc.update("DELETE FROM rivals WHERE user_id=? AND rival_id IN (SELECT id FROM users WHERE lower(handle)=lower(?))",actor.id(),handle);
    }

    /** One player's rank through a finished public contest. Anything else is simply not found. */
    public Map<String,Object> replay(String handle,UUID run) {
        UUID id=(UUID)user(handle).get("id");
        var rows=db.jdbc.queryForList("SELECT cr.entry_id,c.title,cr.rank,cr.entrants FROM contest_results cr "+ContestResults.RUN_JOINS+"JOIN run_entry_members m ON m.entry_id=cr.entry_id WHERE cr.run_id=? AND m.user_id=? AND "+ContestResults.PUBLIC_FINAL,run,id);
        Api.require(!rows.isEmpty(),HttpStatus.NOT_FOUND,"Contest result not found");
        UUID entry=(UUID)rows.get(0).get("entry_id");
        var replay=results.replay(run);
        var out=new LinkedHashMap<String,Object>();
        out.put("title",rows.get(0).get("title"));out.put("rank",rows.get(0).get("rank"));out.put("entrants",replay.entrants());out.put("durationSeconds",replay.durationSeconds());
        out.put("seconds",replay.seconds());out.put("ranks",replay.ranks().getOrDefault(entry,List.of()));
        out.put("solves",replay.solves().getOrDefault(entry,List.of()));
        return out;
    }

    public Map<String,Object> team(UUID team) {
        var out=new LinkedHashMap<>(db.one("SELECT t.id,t.name,t.created_at,cap.handle AS captain FROM teams t JOIN users cap ON cap.id=t.captain_id WHERE t.id=?",team));
        List<Map<String,Object>> members=new ArrayList<>();
        for(var m:db.jdbc.queryForList("SELECT u.id,u.handle,u.display_name FROM team_members m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' WHERE m.team_id=? ORDER BY m.joined_at",team))members.add(summary(m));
        out.put("members",members);
        out.put("sigma",leaderboard.team(team));out.put("teamCount",leaderboard.teamCount());
        var contests=db.jdbc.queryForList("SELECT "+CONTEST_COLUMNS+",(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM run_entry_members x JOIN users u ON u.id=x.user_id WHERE x.entry_id=cr.entry_id) AS members "
                +"FROM contest_results cr "+ContestResults.RUN_JOINS+"JOIN run_entries e ON e.id=cr.entry_id WHERE e.team_id=? AND "+ContestResults.PUBLIC_FINAL+" ORDER BY r.starts_at DESC LIMIT 100",team);
        for(var c:contests)c.remove("entry_id");
        out.put("contests",contests);
        out.put("medals",db.jdbc.queryForMap("SELECT count(*) FILTER (WHERE cr.rank=1) AS gold,count(*) FILTER (WHERE cr.rank=2) AS silver,count(*) FILTER (WHERE cr.rank=3) AS bronze FROM contest_results cr "+ContestResults.RUN_JOINS
                +"JOIN run_entries e ON e.id=cr.entry_id WHERE e.team_id=? AND cr.score>0 AND "+ContestResults.PUBLIC_FINAL,team));
        return out;
    }
}
