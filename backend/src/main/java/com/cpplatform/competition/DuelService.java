package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

/**
 * 1v1 blitz duels on practice problems. A player creates a challenge, anyone with the link (or the
 * open challenge list) joins, and the rounds start a few seconds later. Each round is won by the
 * first accepted submission in submission-time order; a submission still being judged holds the
 * decision, so judge speed never changes who was first. When the timer runs out, the most tests
 * passed wins the round (earliest such submission on a tie), and no test passed is a drawn round.
 * Opponents see each other's verdicts live but never each other's code.
 */
@Service
public class DuelService {
    /** Seconds between "the opponent joined" or "round decided" and the next round's clock. */
    static final int COUNTDOWN=5;
    /** A submission still judged this long after its round ended no longer blocks the decision. */
    static final int STUCK_JUDGING_SECONDS=600;
    private static final Set<String> PENDING=Set.of("QUEUED","RUNNING","RETRY");
    private static final String PLAYERS="SELECT d.*,c.handle AS creator_handle,c.display_name AS creator_name,o.handle AS opponent_handle,o.display_name AS opponent_name,w.handle AS winner_handle "
            +"FROM duels d JOIN users c ON c.id=d.created_by LEFT JOIN users o ON o.id=d.opponent_id LEFT JOIN users w ON w.id=d.winner_id ";
    /** Every submission of one round with its newest judging, in race order. */
    private static final String ROUND_SUBMISSIONS="SELECT s.id,s.submitted_by,s.submitted_at,s.language_code,latest.status,latest.verdict,latest.passed_tests,latest.total_tests,latest.completed_at "
            +"FROM submissions s LEFT JOIN LATERAL (SELECT j.status,j.completed_at,r.verdict,r.passed_tests,r.total_tests FROM judging_jobs j LEFT JOIN judging_results r ON r.job_id=j.id "
            +"WHERE j.submission_id=s.id ORDER BY j.generation DESC LIMIT 1) latest ON true WHERE s.duel_id=? AND s.duel_round=? ORDER BY s.submitted_at,s.id";
    private final Database db;private final SubmissionService submissions;private final CompetitionQueries views;
    public DuelService(Database db,SubmissionService submissions,CompetitionQueries views){this.db=db;this.submissions=submissions;this.views=views;}

    /** Practice problems a duel can draw: published, visible and judgeable in at least one language. */
    private static final String POOL="FROM practice_publications pp JOIN problem_versions v ON v.id=pp.problem_version_id WHERE NOT pp.hidden AND (?::text IS NULL OR v.difficulty=?::text) "
            +"AND EXISTS(SELECT 1 FROM problem_version_languages pl JOIN languages l ON l.code=pl.language_code WHERE pl.problem_version_id=v.id AND l.enabled) "
            +"AND EXISTS(SELECT 1 FROM test_cases t WHERE t.problem_version_id=v.id) ";

    @Transactional
    public UUID create(Actor actor,Map<String,Object> body) {
        int bestOf=Api.number(body,"bestOf",3,1,5);
        Api.require(bestOf%2==1,HttpStatus.BAD_REQUEST,"bestOf must be 1, 3 or 5");
        int roundSeconds=Api.number(body,"roundMinutes",5,1,30)*60,lockout=Api.number(body,"lockoutSeconds",15,0,120);
        String difficulty=body.get("difficulty")==null?null:Api.text(body,"difficulty",16);
        Api.require(difficulty==null || Set.of("EASY","MEDIUM","HARD").contains(difficulty),HttpStatus.BAD_REQUEST,"Invalid difficulty");
        submissions.lockUser(actor);
        Api.require(db.jdbc.queryForObject("SELECT count(*) FROM duels WHERE created_by=? AND status='WAITING'",Long.class,actor.id())<3,
                HttpStatus.TOO_MANY_REQUESTS,"You already have 3 open challenges; cancel one first");
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM duels WHERE status='ACTIVE' AND ? IN (created_by,opponent_id))",actor.id()),HttpStatus.CONFLICT,"Finish your current duel first");
        Api.require(db.jdbc.queryForObject("SELECT count(*) "+POOL,Long.class,difficulty,difficulty)>=bestOf,
                HttpStatus.CONFLICT,"Not enough practice problems"+(difficulty==null?"":" of this difficulty")+" for a best of "+bestOf);
        return db.id("INSERT INTO duels(created_by,rounds_to_win,round_seconds,lockout_seconds,difficulty) VALUES (?,?,?,?,?) RETURNING id",
                actor.id(),(bestOf+1)/2,roundSeconds,lockout,difficulty);
    }

    /** The opponent arrives: rounds are drawn (easiest first) and the first one starts after the countdown. */
    @Transactional
    public void join(Actor actor,UUID id) {
        submissions.lockUser(actor);
        var d=db.one("SELECT * FROM duels WHERE id=? FOR UPDATE",id);
        Api.require("WAITING".equals(d.get("status")),HttpStatus.CONFLICT,"This challenge is no longer open");
        Api.require(!actor.id().equals(d.get("created_by")),HttpStatus.CONFLICT,"Share the link with an opponent; you cannot duel yourself");
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM duels WHERE status='ACTIVE' AND ? IN (created_by,opponent_id))",actor.id()),HttpStatus.CONFLICT,"Finish your current duel first");
        int toWin=((Number)d.get("rounds_to_win")).intValue();
        // Up to two drawn rounds can be replayed before the duel is settled on the score.
        int maxRounds=2*toWin+1;
        String difficulty=(String)d.get("difficulty");
        var picked=db.jdbc.queryForList("SELECT * FROM (SELECT v.id,v.difficulty "+POOL+"ORDER BY random() LIMIT ?) p "
                +"ORDER BY CASE difficulty WHEN 'EASY' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,random()",difficulty,difficulty,maxRounds);
        Api.require(picked.size()>=2*toWin-1,HttpStatus.CONFLICT,"Not enough practice problems are available for this duel");
        db.jdbc.update("UPDATE duels SET opponent_id=?,status='ACTIVE',started_at=clock_timestamp()+make_interval(secs=>?) WHERE id=?",actor.id(),COUNTDOWN,id);
        for(int i=0;i<picked.size();i++)
            db.jdbc.update("INSERT INTO duel_rounds(duel_id,number,problem_version_id) VALUES (?,?,?)",id,i+1,picked.get(i).get("id"));
        startRound(id,1,((Number)d.get("round_seconds")).intValue());
    }

    private void startRound(UUID duel,int number,int seconds) {
        db.jdbc.update("UPDATE duel_rounds SET starts_at=clock_timestamp()+make_interval(secs=>?),ends_at=clock_timestamp()+make_interval(secs=>?) WHERE duel_id=? AND number=?",
                COUNTDOWN,COUNTDOWN+seconds,duel,number);
    }

    /** Cancels an open challenge, or forfeits a running duel (the opponent wins). */
    @Transactional
    public void leave(Actor actor,UUID id) {
        var d=db.one("SELECT * FROM duels WHERE id=? FOR UPDATE",id);
        if("WAITING".equals(d.get("status"))) {
            Api.require(actor.id().equals(d.get("created_by")),HttpStatus.FORBIDDEN,"Only the challenger can cancel");
            db.jdbc.update("UPDATE duels SET status='CANCELLED',finished_at=clock_timestamp() WHERE id=?",id);return;
        }
        Api.require("ACTIVE".equals(d.get("status")),HttpStatus.CONFLICT,"This duel is already over");
        Api.require(isPlayer(actor,d),HttpStatus.FORBIDDEN,"You are not playing this duel");
        UUID other=actor.id().equals(d.get("created_by"))?(UUID)d.get("opponent_id"):(UUID)d.get("created_by");
        db.jdbc.update("UPDATE duel_rounds SET result='FORFEIT',winner_id=?,decided_at=clock_timestamp() WHERE duel_id=? AND result IS NULL AND starts_at IS NOT NULL",other,id);
        finish(id,other,"FORFEIT");
    }

    private static boolean isPlayer(Actor actor,Map<String,Object> d){return actor.id().equals(d.get("created_by")) || actor.id().equals(d.get("opponent_id"));}

    @Transactional
    public UUID submit(Actor actor,UUID id,UUID key,Map<String,Object> body) {
        String source=Api.text(body,"sourceCode",262144),language=Api.text(body,"language",24);
        submissions.lockUser(actor);
        var previous=db.jdbc.queryForList("SELECT * FROM submissions WHERE submitted_by=? AND idempotency_key=?",actor.id(),key);
        if(!previous.isEmpty()) {
            var p=previous.get(0);
            Api.require(id.equals(p.get("duel_id")) && source.equals(p.get("source_code")) && language.equals(p.get("language_code")),HttpStatus.CONFLICT,"Idempotency key reused for different content");
            return (UUID)p.get("id");
        }
        submissions.admit(actor,language);
        var d=db.one("SELECT * FROM duels WHERE id=? FOR UPDATE",id);
        Api.require(isPlayer(actor,d),HttpStatus.FORBIDDEN,"You are not playing this duel");
        Api.require("ACTIVE".equals(d.get("status")),HttpStatus.CONFLICT,"This duel is not running");
        var open=db.jdbc.queryForList("SELECT number,problem_version_id FROM duel_rounds WHERE duel_id=? AND result IS NULL AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp()",id);
        Api.require(!open.isEmpty(),HttpStatus.CONFLICT,"No round is open right now");
        int round=((Number)open.get(0).get("number")).intValue();UUID version=(UUID)open.get(0).get("problem_version_id");
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM problem_version_languages WHERE problem_version_id=? AND language_code=?)",version,language),HttpStatus.BAD_REQUEST,"This problem does not accept that language");
        var mine=db.jdbc.queryForList(ROUND_SUBMISSIONS,id,round).stream().filter(s->actor.id().equals(s.get("submitted_by"))).toList();
        Api.require(mine.stream().noneMatch(s->s.get("status")==null || PENDING.contains(s.get("status"))),HttpStatus.CONFLICT,"Your last submission is still being judged");
        Api.require(mine.stream().noneMatch(s->"ACCEPTED".equals(s.get("verdict"))),HttpStatus.CONFLICT,"You already solved this round");
        long locked=lockedSeconds(mine,((Number)d.get("lockout_seconds")).intValue());
        Api.require(locked<=0,HttpStatus.CONFLICT,"Wrong answer penalty: you can submit again in "+locked+" s");
        UUID submission=db.id("INSERT INTO submissions(context,submitted_by,problem_version_id,language_code,source_code,idempotency_key,duel_id,duel_round) VALUES ('DUEL',?,?,?,?,?,?,?) RETURNING id",
                actor.id(),version,language,source,key,id,round);
        // Between practice (0) and contests (100): a duel is a live race.
        db.jdbc.update("INSERT INTO judging_jobs(submission_id,problem_version_id,priority) VALUES (?,?,50)",submission,version);
        return submission;
    }

    /** Seconds left in the penalty after the player's latest rejected submission; compilation errors are free. */
    private long lockedSeconds(List<Map<String,Object>> mine,int lockout) {
        var last=mine.stream().filter(s->s.get("verdict")!=null && !"ACCEPTED".equals(s.get("verdict")) && !"COMPILATION_ERROR".equals(s.get("verdict")) && s.get("completed_at")!=null)
                .map(s->Api.time(s.get("completed_at"))).max(Comparator.naturalOrder());
        if(last.isEmpty())return 0;
        long now=db.jdbc.queryForObject("SELECT (extract(epoch FROM clock_timestamp())*1000)::bigint",Long.class);
        return (long)Math.ceil((last.get().toEpochMilli()+lockout*1000L-now)/1000.0);
    }

    /** Called every second: expires stale challenges and decides rounds whose race is settled. */
    @Transactional
    public void tick() {
        db.jdbc.update("UPDATE duels SET status='CANCELLED',end_reason='EXPIRED',finished_at=clock_timestamp() WHERE status='WAITING' AND created_at<clock_timestamp()-interval '1 hour'");
        for(var d:db.jdbc.queryForList("SELECT * FROM duels WHERE status='ACTIVE' ORDER BY started_at LIMIT 200 FOR UPDATE SKIP LOCKED")) decide(d);
    }

    private void decide(Map<String,Object> d) {
        UUID id=(UUID)d.get("id");
        var rounds=db.jdbc.queryForList("SELECT *,ends_at<=clock_timestamp() AS over,ends_at<clock_timestamp()-make_interval(secs=>?) AS stuck FROM duel_rounds WHERE duel_id=? AND result IS NULL AND starts_at IS NOT NULL ORDER BY number LIMIT 1",STUCK_JUDGING_SECONDS,id);
        if(rounds.isEmpty())return;
        var round=rounds.get(0);int number=((Number)round.get("number")).intValue();
        boolean over=Boolean.TRUE.equals(round.get("over")),stuck=Boolean.TRUE.equals(round.get("stuck"));
        var race=db.jdbc.queryForList(ROUND_SUBMISSIONS,id,number);
        UUID winner=null;String result=null;
        // The earliest accepted submission wins, but only once every earlier submission has its verdict.
        for(var s:race) {
            boolean pending=s.get("status")==null || PENDING.contains(s.get("status"));
            if(pending && !stuck)return;
            if("ACCEPTED".equals(s.get("verdict"))){winner=(UUID)s.get("submitted_by");result="ACCEPTED";break;}
        }
        if(winner==null) {
            if(!over)return;
            // Time is up: most tests passed wins; the earliest submission reaching that count breaks a tie.
            int best=0;
            for(var s:race) {
                int passed=s.get("passed_tests")==null || "COMPILATION_ERROR".equals(s.get("verdict"))?0:((Number)s.get("passed_tests")).intValue();
                if(passed>best){best=passed;winner=(UUID)s.get("submitted_by");}
            }
            result=winner==null?"DRAW":"TESTS";
        }
        db.jdbc.update("UPDATE duel_rounds SET result=?,winner_id=?,decided_at=clock_timestamp() WHERE duel_id=? AND number=?",result,winner,id,number);
        var score=db.jdbc.queryForList("SELECT winner_id,count(*) AS wins FROM duel_rounds WHERE duel_id=? AND winner_id IS NOT NULL GROUP BY winner_id ORDER BY wins DESC",id);
        int toWin=((Number)d.get("rounds_to_win")).intValue();
        if(!score.isEmpty() && ((Number)score.get(0).get("wins")).intValue()>=toWin){finish(id,(UUID)score.get(0).get("winner_id"),"ROUNDS");return;}
        if(db.exists("SELECT EXISTS(SELECT 1 FROM duel_rounds WHERE duel_id=? AND number=?)",id,number+1)){startRound(id,number+1,((Number)d.get("round_seconds")).intValue());return;}
        // Out of problems: the score decides, and an even score is a drawn duel.
        boolean even=score.isEmpty() || (score.size()>1 && Objects.equals(score.get(0).get("wins"),score.get(1).get("wins")));
        finish(id,even?null:(UUID)score.get(0).get("winner_id"),even?"DRAW":"ROUNDS");
    }

    private void finish(UUID id,UUID winner,String reason) {
        db.jdbc.update("UPDATE duels SET status='FINISHED',winner_id=?,end_reason=?,finished_at=clock_timestamp() WHERE id=?",winner,reason,id);
        // Rounds drawn for the duel but never reached are dropped, so the history shows what was played.
        db.jdbc.update("UPDATE duel_rounds SET starts_at=NULL,ends_at=NULL WHERE duel_id=? AND result IS NULL AND starts_at>clock_timestamp()",id);
        db.jdbc.update("DELETE FROM duel_rounds r WHERE r.duel_id=? AND r.starts_at IS NULL AND NOT EXISTS(SELECT 1 FROM submissions s WHERE s.duel_id=r.duel_id AND s.duel_round=r.number)",id);
    }

    /**
     * Live state for players and spectators: score, rounds and the verdict feed. Problems are named only
     * once their round has started; code and submission IDs are shown to their author only.
     */
    public Map<String,Object> state(Actor actor,UUID id) {
        var d=db.one(PLAYERS+"WHERE d.id=?",id);
        var result=new LinkedHashMap<String,Object>();
        result.put("serverTime",System.currentTimeMillis());
        result.put("duel",d);
        String role=actor.id().equals(d.get("created_by"))?"CREATOR":actor.id().equals(d.get("opponent_id"))?"OPPONENT":"SPECTATOR";
        result.put("role",role);
        var rounds=db.jdbc.queryForList("SELECT r.number,r.starts_at,r.ends_at,r.result,r.decided_at,w.handle AS winner_handle,"
                +"CASE WHEN r.starts_at<=clock_timestamp() THEN r.problem_version_id END AS problem_version_id,"
                +"CASE WHEN r.starts_at<=clock_timestamp() THEN v.title END AS title,CASE WHEN r.starts_at<=clock_timestamp() THEN v.difficulty END AS difficulty "
                +"FROM duel_rounds r JOIN problem_versions v ON v.id=r.problem_version_id LEFT JOIN users w ON w.id=r.winner_id WHERE r.duel_id=? ORDER BY r.number",id);
        result.put("rounds",rounds);
        var feed=new ArrayList<Map<String,Object>>();
        for(var s:db.jdbc.queryForList("SELECT s.id,s.duel_round,s.submitted_by,u.handle,s.submitted_at,s.language_code,latest.status,latest.verdict,latest.passed_tests,latest.total_tests,latest.completed_at "
                +"FROM submissions s JOIN users u ON u.id=s.submitted_by LEFT JOIN LATERAL (SELECT j.status,j.completed_at,r.verdict,r.passed_tests,r.total_tests FROM judging_jobs j LEFT JOIN judging_results r ON r.job_id=j.id "
                +"WHERE j.submission_id=s.id ORDER BY j.generation DESC LIMIT 1) latest ON true WHERE s.duel_id=? ORDER BY s.submitted_at DESC LIMIT 200",id)) {
            boolean own=actor.id().equals(s.get("submitted_by"));
            s.put("mine",own);
            if(!own)s.remove("id");
            s.remove("submitted_by");
            feed.add(s);
        }
        result.put("feed",feed);
        if(!"SPECTATOR".equals(role) && "ACTIVE".equals(d.get("status"))) {
            var current=rounds.stream().filter(r->r.get("result")==null && r.get("problem_version_id")!=null).findFirst();
            if(current.isPresent()) {
                int number=((Number)current.get().get("number")).intValue();
                var mine=db.jdbc.queryForList(ROUND_SUBMISSIONS,id,number).stream().filter(s->actor.id().equals(s.get("submitted_by"))).toList();
                result.put("lockedSeconds",Math.max(0,lockedSeconds(mine,((Number)d.get("lockout_seconds")).intValue())));
            }
        }
        return result;
    }

    /** The statement of a round, available to everyone once that round has started. */
    public Map<String,Object> problem(Actor actor,UUID id,int number) {
        var r=db.one("SELECT problem_version_id FROM duel_rounds WHERE duel_id=? AND number=? AND starts_at<=clock_timestamp()",id,number);
        return views.problem((UUID)r.get("problem_version_id"));
    }

    /** The caller's recent duels and the open challenges anyone can accept. */
    public Map<String,Object> list(Actor actor) {
        String score=",(SELECT count(*) FROM duel_rounds r WHERE r.duel_id=d.id AND r.winner_id=d.created_by) AS creator_wins,(SELECT count(*) FROM duel_rounds r WHERE r.duel_id=d.id AND r.winner_id=d.opponent_id) AS opponent_wins ";
        String select=PLAYERS.replace("FROM duels d",score+"FROM duels d");
        return Map.of("mine",db.jdbc.queryForList(select+"WHERE ? IN (d.created_by,d.opponent_id) AND d.status<>'CANCELLED' ORDER BY d.created_at DESC LIMIT 30",actor.id()),
                "open",db.jdbc.queryForList(select+"WHERE d.status='WAITING' AND d.created_by<>? ORDER BY d.created_at DESC LIMIT 30",actor.id()),
                "live",db.jdbc.queryForList(select+"WHERE d.status='ACTIVE' ORDER BY d.started_at DESC LIMIT 30"));
    }
}
