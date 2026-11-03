package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Pattern;

/**
 * Blitz rooms on problems from the duel pool (duel_problems), kept apart from practice so duel
 * problems stay private. Three kinds of room:
 * <ul>
 * <li>DUEL: 1v1. TEAMS: two teams (2v2 or 3v3). Both are races: a side wins a round, and the first side
 * to win rounds_to_win rounds wins the room.</li>
 * <li>FFA: free-for-all for up to 10 players over rounds_total rounds. Each round ranks every player and
 * gives placement points (N players: N for first, N-1 for second, ...); the most points wins.</li>
 * </ul>
 * A round is ranked by its twist (modifier). Speed twists (CLASSIC, BLIND, NO_FOR, NO_PLUS, LANGUAGE)
 * rank accepted submissions by submission time; a submission still being judged holds the decision, so
 * judge speed never changes who was first. GOLF (shortest accepted code) and FASTEST (quickest accepted
 * run) keep the round open until the clock ends, so players can improve. Without an accepted
 * submission, most tests passed ranks next (duel submissions run every test), then the earliest
 * submission reaching that count. Nobody passing a test is a drawn round.
 * Players see each other's verdicts, test counts and code length, never code. "Run examples"
 * submissions (samples_only) are judged on the examples only and never take part in the ranking.
 */
@Service
public class DuelService {
    /** Seconds between "the room starts" or "round decided" and the next round's clock; the twist is shown meanwhile. */
    static final int COUNTDOWN=6;
    /** A submission still judged this long after its round ended no longer blocks the decision. */
    static final int STUCK_JUDGING_SECONDS=600;
    static final List<String> MODIFIERS=List.of("CLASSIC","BLIND","NO_FOR","NO_PLUS","GOLF","FASTEST","LANGUAGE");
    private static final Set<String> IMPROVING=Set.of("GOLF","FASTEST");
    private static final Set<String> PENDING=Set.of("QUEUED","RUNNING","RETRY");
    private static final Pattern FOR=Pattern.compile("\\bfor\\b");
    /** Every counted submission of one round with its newest judging, in race order. */
    private static final String ROUND_SUBMISSIONS="SELECT s.id,s.submitted_by,s.submitted_at,s.language_code,octet_length(btrim(s.source_code,E' \\t\\r\\n')) AS length,"
            +"latest.status,latest.verdict,latest.passed_tests,latest.total_tests,latest.execution_time_ms,latest.completed_at "
            +"FROM submissions s LEFT JOIN LATERAL (SELECT j.status,j.completed_at,r.verdict,r.passed_tests,r.total_tests,r.execution_time_ms FROM judging_jobs j LEFT JOIN judging_results r ON r.job_id=j.id "
            +"WHERE j.submission_id=s.id ORDER BY j.generation DESC LIMIT 1) latest ON true WHERE s.duel_id=? AND s.duel_round=? AND NOT s.samples_only ORDER BY s.submitted_at,s.id";
    /** Duel problems a room can draw: in the pool, not hidden or deleted, and judgeable in at least one language. */
    private static final String POOL="FROM duel_problems dp JOIN problem_versions v ON v.id=dp.problem_version_id JOIN problems p ON p.id=dp.problem_id "
            +"WHERE NOT dp.hidden AND p.archived_at IS NULL AND (?::text IS NULL OR v.difficulty=?::text) "
            +"AND EXISTS(SELECT 1 FROM problem_version_languages pl JOIN languages l ON l.code=pl.language_code WHERE pl.problem_version_id=v.id AND l.enabled) "
            +"AND EXISTS(SELECT 1 FROM test_cases t WHERE t.problem_version_id=v.id) ";
    private final Database db;private final SubmissionService submissions;private final CompetitionQueries views;private final Permissions access;
    public DuelService(Database db,SubmissionService submissions,CompetitionQueries views,Permissions access){this.db=db;this.submissions=submissions;this.views=views;this.access=access;}

    // ---------- Lobby ----------

    /** One open or running room per player at a time, as host or player. */
    private void requireFree(Actor actor) {
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM duel_players p JOIN duels d ON d.id=p.duel_id WHERE p.user_id=? AND p.left_at IS NULL AND d.status IN ('WAITING','ACTIVE'))",actor.id()),
                HttpStatus.CONFLICT,"Finish or leave your current room first");
    }
    /** Fewest problems a room needs; DUEL and TEAMS draw up to two more for replayed draws. */
    private static int roundsNeeded(String mode,int toWin,Integer total){return "FFA".equals(mode)?total:2*toWin-1;}

    @Transactional
    public UUID create(Actor actor,Map<String,Object> body) {
        String mode=Api.optional(body,"mode","DUEL",8);
        Api.require(Set.of("DUEL","TEAMS","FFA").contains(mode),HttpStatus.BAD_REQUEST,"mode must be DUEL, TEAMS or FFA");
        int toWin=1,maxPlayers=2;Integer total=null;
        if("FFA".equals(mode)) {
            maxPlayers=Api.number(body,"maxPlayers",10,3,10);total=Api.number(body,"rounds",3,1,7);
        } else {
            int bestOf=Api.number(body,"bestOf",3,1,5);
            Api.require(bestOf%2==1,HttpStatus.BAD_REQUEST,"bestOf must be 1, 3 or 5");
            toWin=(bestOf+1)/2;
            if("TEAMS".equals(mode))maxPlayers=2*Api.number(body,"teamSize",2,2,3);
        }
        int roundSeconds=Api.number(body,"roundMinutes",5,1,30)*60,lockout=Api.number(body,"lockoutSeconds",15,0,120);
        String difficulty=body.get("difficulty")==null?null:Api.text(body,"difficulty",16);
        Api.require(difficulty==null || Set.of("EASY","MEDIUM","HARD").contains(difficulty),HttpStatus.BAD_REQUEST,"Invalid difficulty");
        List<String> modifiers=new ArrayList<>();
        if(body.get("modifiers")!=null) {
            Api.require(body.get("modifiers") instanceof List<?> l && l.size()<=MODIFIERS.size(),HttpStatus.BAD_REQUEST,"modifiers must be a list");
            for(Object m:(List<?>)body.get("modifiers")) {
                Api.require(MODIFIERS.contains(String.valueOf(m)),HttpStatus.BAD_REQUEST,"Unknown twist: "+m);
                if(!modifiers.contains(String.valueOf(m)))modifiers.add(String.valueOf(m));
            }
        }
        submissions.lockUser(actor);
        requireFree(actor);
        int needed=roundsNeeded(mode,toWin,total);
        Api.require(db.jdbc.queryForObject("SELECT count(*) "+POOL,Long.class,difficulty,difficulty)>=needed,
                HttpStatus.CONFLICT,"Not enough duel problems"+(difficulty==null?"":" of this difficulty")+" for "+needed+" rounds");
        UUID id=db.id("INSERT INTO duels(created_by,mode,max_players,rounds_to_win,rounds_total,round_seconds,lockout_seconds,difficulty,modifiers) VALUES (?,?,?,?,?,?,?,?,?::text[]) RETURNING id",
                actor.id(),mode,maxPlayers,toWin,total,roundSeconds,lockout,difficulty,modifiers.toArray(new String[0]));
        db.jdbc.update("INSERT INTO duel_players(duel_id,user_id,team) VALUES (?,?,?)",id,actor.id(),"TEAMS".equals(mode)?1:null);
        return id;
    }

    /** Joins an open room (on the requested team, or the smaller one). A full room starts by itself. */
    @Transactional
    public void join(Actor actor,UUID id,Integer team) {
        submissions.lockUser(actor);
        var d=db.one("SELECT * FROM duels WHERE id=? FOR UPDATE",id);
        Api.require("WAITING".equals(d.get("status")),HttpStatus.CONFLICT,"This room is no longer open");
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM duel_players WHERE duel_id=? AND user_id=?)",id,actor.id()),HttpStatus.CONFLICT,"You are already in this room");
        requireFree(actor);
        var players=players(id);
        int max=((Number)d.get("max_players")).intValue();
        Api.require(players.size()<max,HttpStatus.CONFLICT,"This room is full");
        Integer side=null;
        if("TEAMS".equals(d.get("mode"))) {
            long one=players.stream().filter(p->team(p)==1).count(),two=players.size()-one;
            side=team!=null && (team==1?one:two)<max/2?team:one<=two?1:2;
        }
        db.jdbc.update("INSERT INTO duel_players(duel_id,user_id,team) VALUES (?,?,?)",id,actor.id(),side);
        if(players.size()+1==max)begin(d);
    }

    /** The host starts a room that is not full: free-for-all needs two players, teams one player each. */
    @Transactional
    public void start(Actor actor,UUID id) {
        var d=db.one("SELECT * FROM duels WHERE id=? FOR UPDATE",id);
        Api.require(actor.id().equals(d.get("created_by")),HttpStatus.FORBIDDEN,"Only the host starts the room");
        Api.require("WAITING".equals(d.get("status")),HttpStatus.CONFLICT,"This room is not waiting");
        var players=players(id);
        if("TEAMS".equals(d.get("mode")))
            Api.require(players.stream().anyMatch(p->team(p)==1) && players.stream().anyMatch(p->team(p)==2),HttpStatus.CONFLICT,"Each team needs at least one player");
        else Api.require(players.size()>=2,HttpStatus.CONFLICT,"Wait for at least one opponent");
        begin(d);
    }

    /** Moves the caller to the other team while the room waits. */
    @Transactional
    public void team(Actor actor,UUID id,int team) {
        Api.require(team==1 || team==2,HttpStatus.BAD_REQUEST,"team must be 1 or 2");
        var d=db.one("SELECT * FROM duels WHERE id=? FOR UPDATE",id);
        Api.require("TEAMS".equals(d.get("mode")) && "WAITING".equals(d.get("status")),HttpStatus.CONFLICT,"Teams can only change before the room starts");
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM duel_players WHERE duel_id=? AND user_id=?)",id,actor.id()),HttpStatus.FORBIDDEN,"You are not in this room");
        long size=db.jdbc.queryForObject("SELECT count(*) FROM duel_players WHERE duel_id=? AND team=? AND user_id<>?",Long.class,id,(short)team,actor.id());
        Api.require(size<((Number)d.get("max_players")).intValue()/2,HttpStatus.CONFLICT,"That team is full");
        db.jdbc.update("UPDATE duel_players SET team=? WHERE duel_id=? AND user_id=?",(short)team,id,actor.id());
    }

    /** Draws the problems (easiest first) and a twist for every round, then starts round 1. */
    private void begin(Map<String,Object> d) {
        UUID id=(UUID)d.get("id");String mode=(String)d.get("mode"),difficulty=(String)d.get("difficulty");
        int toWin=((Number)d.get("rounds_to_win")).intValue();
        Integer total=d.get("rounds_total")==null?null:((Number)d.get("rounds_total")).intValue();
        int wanted="FFA".equals(mode)?total:2*toWin+1,needed=roundsNeeded(mode,toWin,total);
        var picked=db.jdbc.queryForList("SELECT * FROM (SELECT v.id,v.difficulty "+POOL+"ORDER BY random() LIMIT ?) p "
                +"ORDER BY CASE difficulty WHEN 'EASY' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,random()",difficulty,difficulty,wanted);
        Api.require(picked.size()>=needed,HttpStatus.CONFLICT,"Not enough duel problems are available for this room");
        List<String> twists=new ArrayList<>(Arrays.asList(strings(d.get("modifiers"))));
        if(twists.isEmpty())twists.add("CLASSIC");
        var random=ThreadLocalRandom.current();
        for(int i=0;i<picked.size();i++) {
            UUID version=(UUID)picked.get(i).get("id");
            String twist=twists.get(random.nextInt(twists.size()));
            String language=null;
            if("LANGUAGE".equals(twist)) {
                var languages=db.jdbc.queryForList("SELECT pl.language_code FROM problem_version_languages pl JOIN languages l ON l.code=pl.language_code WHERE pl.problem_version_id=? AND l.enabled ORDER BY 1",String.class,version);
                language=languages.get(random.nextInt(languages.size()));
            }
            db.jdbc.update("INSERT INTO duel_rounds(duel_id,number,problem_version_id,modifier,forced_language) VALUES (?,?,?,?,?)",id,i+1,version,twist,language);
        }
        db.jdbc.update("UPDATE duels SET status='ACTIVE',started_at=clock_timestamp()+make_interval(secs=>?) WHERE id=?",COUNTDOWN,id);
        startRound(id,1,((Number)d.get("round_seconds")).intValue());
    }

    private static String[] strings(Object array) {
        if(array instanceof java.sql.Array a) try{return (String[])a.getArray();}catch(java.sql.SQLException e){throw new IllegalStateException(e);}
        return array instanceof String[] s?s:new String[0];
    }

    private void startRound(UUID duel,int number,int seconds) {
        db.jdbc.update("UPDATE duel_rounds SET starts_at=clock_timestamp()+make_interval(secs=>?),ends_at=clock_timestamp()+make_interval(secs=>?) WHERE duel_id=? AND number=?",
                COUNTDOWN,COUNTDOWN+seconds,duel,number);
    }

    private static int team(Map<String,Object> player){return player.get("team")==null?0:((Number)player.get("team")).intValue();}

    private List<Map<String,Object>> players(UUID id) {
        return db.jdbc.queryForList("SELECT p.user_id,p.team,p.left_at,p.joined_at,u.handle,u.display_name FROM duel_players p JOIN users u ON u.id=p.user_id WHERE p.duel_id=? ORDER BY p.joined_at,u.handle",id);
    }

    /**
     * Leaving an open room cancels it (host) or frees the seat. Leaving a running room forfeits: in a 1v1
     * the opponent wins, a team that has nobody left loses, and a free-for-all ends when one player remains.
     */
    @Transactional
    public void leave(Actor actor,UUID id) {
        var d=db.one("SELECT * FROM duels WHERE id=? FOR UPDATE",id);
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM duel_players WHERE duel_id=? AND user_id=? AND left_at IS NULL)",id,actor.id()),HttpStatus.FORBIDDEN,"You are not in this room");
        if("WAITING".equals(d.get("status"))) {
            if(actor.id().equals(d.get("created_by")))db.jdbc.update("UPDATE duels SET status='CANCELLED',finished_at=clock_timestamp() WHERE id=?",id);
            else db.jdbc.update("DELETE FROM duel_players WHERE duel_id=? AND user_id=?",id,actor.id());
            return;
        }
        Api.require("ACTIVE".equals(d.get("status")),HttpStatus.CONFLICT,"This room is already over");
        db.jdbc.update("UPDATE duel_players SET left_at=clock_timestamp() WHERE duel_id=? AND user_id=?",id,actor.id());
        var active=players(id).stream().filter(p->p.get("left_at")==null).toList();
        String mode=(String)d.get("mode");
        if("TEAMS".equals(mode)) {
            var teams=active.stream().map(DuelService::team).distinct().toList();
            if(teams.size()==1)forfeit(id,null,teams.get(0));
        } else if(active.size()==1) forfeit(id,(UUID)active.get(0).get("user_id"),null);
    }

    private void forfeit(UUID id,UUID winner,Integer team) {
        UUID member=winner!=null?winner:db.id("SELECT user_id FROM duel_players WHERE duel_id=? AND team=? AND left_at IS NULL LIMIT 1",id,team.shortValue());
        db.jdbc.update("UPDATE duel_rounds SET result='FORFEIT',winner_id=?,winner_team=?,decided_at=clock_timestamp() WHERE duel_id=? AND result IS NULL AND starts_at IS NOT NULL",
                member,team==null?null:team.shortValue(),id);
        finish(id,winner,team,"FORFEIT");
    }

    // ---------- Playing ----------

    @Transactional
    public UUID submit(Actor actor,UUID id,UUID key,Map<String,Object> body) {
        String source=Api.text(body,"sourceCode",262144),language=Api.text(body,"language",24);
        // mode=samples: "run examples", judged on the statement's examples only and never counted.
        boolean samples="samples".equals(body.get("mode"));
        submissions.lockUser(actor);
        var previous=db.jdbc.queryForList("SELECT * FROM submissions WHERE submitted_by=? AND idempotency_key=?",actor.id(),key);
        if(!previous.isEmpty()) {
            var p=previous.get(0);
            Api.require(id.equals(p.get("duel_id")) && samples==Boolean.TRUE.equals(p.get("samples_only")) && source.equals(p.get("source_code")) && language.equals(p.get("language_code")),HttpStatus.CONFLICT,"Idempotency key reused for different content");
            return (UUID)p.get("id");
        }
        submissions.admit(actor,language);
        var d=db.one("SELECT * FROM duels WHERE id=? FOR UPDATE",id);
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM duel_players WHERE duel_id=? AND user_id=? AND left_at IS NULL)",id,actor.id()),HttpStatus.FORBIDDEN,"You are not playing in this room");
        Api.require("ACTIVE".equals(d.get("status")),HttpStatus.CONFLICT,"This room is not running");
        var open=db.jdbc.queryForList("SELECT number,problem_version_id,modifier,forced_language FROM duel_rounds WHERE duel_id=? AND result IS NULL AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp()",id);
        Api.require(!open.isEmpty(),HttpStatus.CONFLICT,"No round is open right now");
        var round=open.get(0);
        int number=((Number)round.get("number")).intValue();UUID version=(UUID)round.get("problem_version_id");String twist=(String)round.get("modifier");
        Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM problem_version_languages WHERE problem_version_id=? AND language_code=?)",version,language),HttpStatus.BAD_REQUEST,"This problem does not accept that language");
        checkTwist(twist,(String)round.get("forced_language"),language,source,samples);
        if(samples)Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM test_cases WHERE problem_version_id=? AND is_sample)",version),HttpStatus.CONFLICT,"This problem has no example tests");
        var mine=samples?List.<Map<String,Object>>of():db.jdbc.queryForList(ROUND_SUBMISSIONS,id,number).stream().filter(s->actor.id().equals(s.get("submitted_by"))).toList();
        Api.require(mine.stream().noneMatch(DuelService::pending),HttpStatus.CONFLICT,"Your last submission is still being judged");
        // Golf and fastest rounds stay open after an accepted answer so a player can improve it.
        Api.require(IMPROVING.contains(twist) || mine.stream().noneMatch(s->"ACCEPTED".equals(s.get("verdict"))),HttpStatus.CONFLICT,"You already solved this round");
        long locked=lockedSeconds(mine,((Number)d.get("lockout_seconds")).intValue());
        Api.require(locked<=0,HttpStatus.CONFLICT,"Wrong answer penalty: you can submit again in "+locked+" s");
        UUID submission=db.id("INSERT INTO submissions(context,submitted_by,problem_version_id,language_code,source_code,idempotency_key,duel_id,duel_round,samples_only) VALUES ('DUEL',?,?,?,?,?,?,?,?) RETURNING id",
                actor.id(),version,language,source,key,id,number,samples);
        // Between practice (0) and contests (100): a duel is a live race.
        db.jdbc.update("INSERT INTO judging_jobs(submission_id,problem_version_id,priority) VALUES (?,?,50)",submission,version);
        return submission;
    }

    /** Twist rules checked before judging; a refused submission costs nothing. */
    public static void checkTwist(String twist,String forcedLanguage,String language,String source,boolean samples) {
        switch(twist) {
            case "BLIND" -> Api.require(!samples,HttpStatus.CONFLICT,"Blind round: there are no examples to run");
            case "NO_FOR" -> Api.require(!FOR.matcher(source).find(),HttpStatus.BAD_REQUEST,"This round bans the word \"for\" (comments and strings included)");
            case "NO_PLUS" -> Api.require(source.indexOf('+')<0,HttpStatus.BAD_REQUEST,"This round bans the + character (includes, comments and strings included)");
            case "LANGUAGE" -> Api.require(language.equals(forcedLanguage),HttpStatus.BAD_REQUEST,"This round must be solved in "+forcedLanguage);
            default -> {}
        }
    }

    private static boolean pending(Map<String,Object> s){return s.get("status")==null || PENDING.contains(s.get("status"));}

    /** Seconds left in the penalty after the player's latest rejected submission; compilation errors are free. */
    private long lockedSeconds(List<Map<String,Object>> mine,int lockout) {
        var last=mine.stream().filter(s->s.get("verdict")!=null && !"ACCEPTED".equals(s.get("verdict")) && !"COMPILATION_ERROR".equals(s.get("verdict")) && s.get("completed_at")!=null)
                .map(s->Api.time(s.get("completed_at"))).max(Comparator.naturalOrder());
        if(last.isEmpty())return 0;
        long now=db.jdbc.queryForObject("SELECT (extract(epoch FROM clock_timestamp())*1000)::bigint",Long.class);
        return (long)Math.ceil((last.get().toEpochMilli()+lockout*1000L-now)/1000.0);
    }

    // ---------- Deciding rounds ----------

    /** Called every second: expires stale rooms and decides rounds whose ranking is settled. */
    @Transactional
    public void tick() {
        db.jdbc.update("UPDATE duels SET status='CANCELLED',end_reason='EXPIRED',finished_at=clock_timestamp() WHERE status='WAITING' AND created_at<clock_timestamp()-interval '1 hour'");
        for(var d:db.jdbc.queryForList("SELECT * FROM duels WHERE status='ACTIVE' ORDER BY started_at LIMIT 200 FOR UPDATE SKIP LOCKED")) decide(d);
    }

    /** One side's best effort in a round: accepted with its rank metric, or the most tests passed. */
    public record Entry(Object side,UUID user,boolean accepted,long metric,int passed,Instant at) {}

    private void decide(Map<String,Object> d) {
        UUID id=(UUID)d.get("id");String mode=(String)d.get("mode");
        var rounds=db.jdbc.queryForList("SELECT *,ends_at<=clock_timestamp() AS over,ends_at<clock_timestamp()-make_interval(secs=>?) AS stuck FROM duel_rounds WHERE duel_id=? AND result IS NULL AND starts_at IS NOT NULL ORDER BY number LIMIT 1",STUCK_JUDGING_SECONDS,id);
        if(rounds.isEmpty())return;
        var round=rounds.get(0);int number=((Number)round.get("number")).intValue();String twist=(String)round.get("modifier");
        boolean over=Boolean.TRUE.equals(round.get("over")),stuck=Boolean.TRUE.equals(round.get("stuck"));
        var players=players(id);
        var race=db.jdbc.queryForList(ROUND_SUBMISSIONS,id,number);
        boolean waiting=!stuck && race.stream().anyMatch(DuelService::pending);
        boolean decided=over && !waiting;
        if(!decided && !IMPROVING.contains(twist)) {
            if(!"FFA".equals(mode)) {
                // A race: the earliest accepted submission wins once every earlier submission has its verdict.
                for(var s:race) {
                    if(pending(s) && !stuck)break;
                    if("ACCEPTED".equals(s.get("verdict"))){decided=true;break;}
                }
            } else {
                // Free-for-all: the round ends early once every player still in the room is accepted.
                var solved=race.stream().filter(s->"ACCEPTED".equals(s.get("verdict"))).map(s->s.get("submitted_by")).toList();
                decided=!waiting && players.stream().filter(p->p.get("left_at")==null).allMatch(p->solved.contains(p.get("user_id")));
            }
        }
        if(!decided)return;
        record(d,number,twist,players,ranking(mode,twist,race,players,stuck));
        advance(d,number);
    }

    /** Sides ranked best first; sides that passed no test are not ranked. */
    public static List<Entry> ranking(String mode,String twist,List<Map<String,Object>> race,List<Map<String,Object>> players,boolean stuck) {
        Map<UUID,Object> sideOf=new HashMap<>();
        for(var p:players)sideOf.put((UUID)p.get("user_id"),"TEAMS".equals(mode)?(Object)team(p):p.get("user_id"));
        Map<Object,Entry> best=new HashMap<>();
        for(var s:race) {
            if(pending(s) && !stuck)continue;
            UUID user=(UUID)s.get("submitted_by");Object side=sideOf.get(user);
            if(side==null)continue;
            Instant at=Api.time(s.get("submitted_at"));
            boolean accepted="ACCEPTED".equals(s.get("verdict"));
            int passed=s.get("passed_tests")==null || "COMPILATION_ERROR".equals(s.get("verdict"))?0:((Number)s.get("passed_tests")).intValue();
            long metric=!accepted?0:"GOLF".equals(twist)?((Number)s.get("length")).longValue():"FASTEST".equals(twist)?((Number)s.get("execution_time_ms")).longValue():at.toEpochMilli();
            var entry=new Entry(side,user,accepted,metric,passed,at);
            var current=best.get(side);
            if(current==null || BETTER.compare(entry,current)<0)best.put(side,entry);
        }
        return best.values().stream().filter(e->e.accepted() || e.passed()>0).sorted(BETTER).toList();
    }
    /** Accepted first (lower metric wins), then most tests passed; the earlier submission breaks every tie. */
    static final Comparator<Entry> BETTER=Comparator.comparing((Entry e)->!e.accepted()).thenComparingLong(Entry::metric)
            .thenComparing(Comparator.comparingInt(Entry::passed).reversed()).thenComparing(Entry::at);

    /** Stores the round's result and every player's place and points. */
    private void record(Map<String,Object> d,int number,String twist,List<Map<String,Object>> players,List<Entry> ranked) {
        UUID id=(UUID)d.get("id");String mode=(String)d.get("mode");
        String result=ranked.isEmpty()?"DRAW":"FFA".equals(mode)?"POINTS":!ranked.get(0).accepted()?"TESTS"
                :"GOLF".equals(twist)?"SHORTEST":"FASTEST".equals(twist)?"FASTEST":"ACCEPTED";
        Entry top=ranked.isEmpty()?null:ranked.get(0);
        db.jdbc.update("UPDATE duel_rounds SET result=?,winner_id=?,winner_team=?,decided_at=clock_timestamp() WHERE duel_id=? AND number=?",
                result,top==null?null:top.user(),top!=null && "TEAMS".equals(mode)?((Integer)top.side()).shortValue():null,id,number);
        int n=players.size();
        for(var p:players) {
            UUID user=(UUID)p.get("user_id");Object side="TEAMS".equals(mode)?(Object)team(p):user;
            int place=ranked.size()+1;
            for(int i=0;i<ranked.size();i++)if(ranked.get(i).side().equals(side)){place=i+1;break;}
            // Races give the round to its winning side; free-for-all gives N, N-1, ... to ranked players.
            int points="FFA".equals(mode)?(place<=ranked.size()?n-place+1:0):(place==1 && top!=null?1:0);
            db.jdbc.update("INSERT INTO duel_round_results(duel_id,number,user_id,place,points) VALUES (?,?,?,?,?)",id,number,user,place,points);
        }
    }

    private void advance(Map<String,Object> d,int number) {
        UUID id=(UUID)d.get("id");String mode=(String)d.get("mode");
        boolean more=db.exists("SELECT EXISTS(SELECT 1 FROM duel_rounds WHERE duel_id=? AND number=?)",id,number+1);
        if("FFA".equals(mode)) {
            if(more){startRound(id,number+1,((Number)d.get("round_seconds")).intValue());return;}
            // Most points among players still in the room; then most round wins; otherwise a draw.
            var totals=db.jdbc.queryForList("SELECT r.user_id,sum(r.points) AS points,count(*) FILTER (WHERE r.place=1 AND r.points>0) AS wins FROM duel_round_results r "
                    +"JOIN duel_players p ON p.duel_id=r.duel_id AND p.user_id=r.user_id WHERE r.duel_id=? AND p.left_at IS NULL GROUP BY r.user_id ORDER BY points DESC,wins DESC",id);
            boolean tie=totals.isEmpty() || ((Number)totals.get(0).get("points")).longValue()==0
                    || (totals.size()>1 && Objects.equals(totals.get(0).get("points"),totals.get(1).get("points")) && Objects.equals(totals.get(0).get("wins"),totals.get(1).get("wins")));
            finish(id,tie?null:(UUID)totals.get(0).get("user_id"),null,tie?"DRAW":"ROUNDS");return;
        }
        String side="TEAMS".equals(mode)?"winner_team":"winner_id";
        var score=db.jdbc.queryForList("SELECT "+side+" AS side,count(*) AS wins FROM duel_rounds WHERE duel_id=? AND "+side+" IS NOT NULL GROUP BY 1 ORDER BY wins DESC",id);
        int toWin=((Number)d.get("rounds_to_win")).intValue();
        if(!score.isEmpty() && ((Number)score.get(0).get("wins")).intValue()>=toWin){finishSide(id,mode,score.get(0).get("side"),"ROUNDS");return;}
        if(more){startRound(id,number+1,((Number)d.get("round_seconds")).intValue());return;}
        // Out of problems: the score decides, and an even score is a drawn room.
        boolean even=score.isEmpty() || (score.size()>1 && Objects.equals(score.get(0).get("wins"),score.get(1).get("wins")));
        if(even)finish(id,null,null,"DRAW");else finishSide(id,mode,score.get(0).get("side"),"ROUNDS");
    }

    private void finishSide(UUID id,String mode,Object side,String reason) {
        if("TEAMS".equals(mode))finish(id,null,((Number)side).intValue(),reason);else finish(id,(UUID)side,null,reason);
    }

    private void finish(UUID id,UUID winner,Integer team,String reason) {
        db.jdbc.update("UPDATE duels SET status='FINISHED',winner_id=?,winner_team=?,end_reason=?,finished_at=clock_timestamp() WHERE id=?",winner,team==null?null:team.shortValue(),reason,id);
        // Rounds drawn for the room but never reached are dropped, so the history shows what was played.
        db.jdbc.update("UPDATE duel_rounds SET starts_at=NULL,ends_at=NULL WHERE duel_id=? AND result IS NULL AND starts_at>clock_timestamp()",id);
        db.jdbc.update("DELETE FROM duel_rounds r WHERE r.duel_id=? AND r.starts_at IS NULL AND NOT EXISTS(SELECT 1 FROM submissions s WHERE s.duel_id=r.duel_id AND s.duel_round=r.number)",id);
    }

    // ---------- Reading ----------

    private static final String ROOM="SELECT d.id,d.status,d.mode,d.max_players,d.rounds_to_win,d.rounds_total,d.round_seconds,d.lockout_seconds,d.difficulty,d.modifiers,"
            +"d.created_at,d.started_at,d.finished_at,d.end_reason,d.winner_team,d.created_by,h.handle AS host_handle,w.handle AS winner_handle "
            +"FROM duels d JOIN users h ON h.id=d.created_by LEFT JOIN users w ON w.id=d.winner_id ";

    /** Rooms with their players and totals (points; in races a point is a round won). */
    private List<Map<String,Object>> rooms(List<Map<String,Object>> rows) {
        if(rows.isEmpty())return rows;
        String ids="{"+String.join(",",rows.stream().map(r->String.valueOf(r.get("id"))).toList())+"}";
        var players=db.jdbc.queryForList("SELECT p.duel_id,u.handle,u.display_name,p.team,p.left_at IS NOT NULL AS left_room,"
                +"(SELECT coalesce(sum(r.points),0) FROM duel_round_results r WHERE r.duel_id=p.duel_id AND r.user_id=p.user_id) AS points,"
                +"(SELECT count(*) FROM duel_round_results r WHERE r.duel_id=p.duel_id AND r.user_id=p.user_id AND r.place=1 AND r.points>0) AS wins "
                +"FROM duel_players p JOIN users u ON u.id=p.user_id WHERE p.duel_id=ANY(?::uuid[]) ORDER BY p.joined_at,u.handle",ids);
        Map<Object,List<Map<String,Object>>> byRoom=new HashMap<>();
        for(var p:players)byRoom.computeIfAbsent(p.remove("duel_id"),k->new ArrayList<>()).add(p);
        for(var r:rows) {
            r.put("modifiers",List.of(strings(r.get("modifiers"))));
            r.put("players",byRoom.getOrDefault(r.get("id"),List.of()));
        }
        return rows;
    }

    /**
     * Live state for players and spectators. Twists show from the round's countdown, problems once the
     * round starts; code and submission IDs are shown to their author only.
     */
    public Map<String,Object> state(Actor actor,UUID id) {
        var d=rooms(new ArrayList<>(List.of(new LinkedHashMap<>(db.one(ROOM+"WHERE d.id=?",id))))).get(0);
        var result=new LinkedHashMap<String,Object>();
        result.put("serverTime",System.currentTimeMillis());
        var me=db.jdbc.queryForList("SELECT team,left_at FROM duel_players WHERE duel_id=? AND user_id=?",id,actor.id());
        boolean player=!me.isEmpty() && me.get(0).get("left_at")==null;
        result.put("duel",d);
        result.put("role",player?"PLAYER":"SPECTATOR");
        result.put("host",actor.id().equals(d.remove("created_by")));
        result.put("myTeam",me.isEmpty()?null:me.get(0).get("team"));
        var rounds=db.jdbc.queryForList("SELECT r.number,r.starts_at,r.ends_at,r.result,r.decided_at,r.winner_team,w.handle AS winner_handle,"
                +"CASE WHEN r.starts_at IS NOT NULL THEN r.modifier END AS modifier,CASE WHEN r.starts_at IS NOT NULL THEN r.forced_language END AS forced_language,"
                +"CASE WHEN r.starts_at<=clock_timestamp() THEN r.problem_version_id END AS problem_version_id,"
                +"CASE WHEN r.starts_at<=clock_timestamp() THEN v.title END AS title,CASE WHEN r.starts_at<=clock_timestamp() THEN v.difficulty END AS difficulty "
                +"FROM duel_rounds r JOIN problem_versions v ON v.id=r.problem_version_id LEFT JOIN users w ON w.id=r.winner_id WHERE r.duel_id=? ORDER BY r.number",id);
        var places=db.jdbc.queryForList("SELECT r.number,u.handle,r.place,r.points FROM duel_round_results r JOIN users u ON u.id=r.user_id WHERE r.duel_id=? ORDER BY r.number,r.place,u.handle",id);
        for(var r:rounds)r.put("places",places.stream().filter(p->p.get("number").equals(r.get("number"))).map(p->Map.of("handle",p.get("handle"),"place",p.get("place"),"points",p.get("points"))).toList());
        result.put("rounds",rounds);
        var feed=new ArrayList<Map<String,Object>>();
        for(var s:db.jdbc.queryForList("SELECT s.id,s.duel_round,s.submitted_by,u.handle,dp.team,s.submitted_at,s.language_code,octet_length(btrim(s.source_code,E' \\t\\r\\n')) AS length,"
                +"latest.status,latest.verdict,latest.passed_tests,latest.total_tests,latest.execution_time_ms "
                +"FROM submissions s JOIN users u ON u.id=s.submitted_by LEFT JOIN duel_players dp ON dp.duel_id=s.duel_id AND dp.user_id=s.submitted_by "
                +"LEFT JOIN LATERAL (SELECT j.status,r.verdict,r.passed_tests,r.total_tests,r.execution_time_ms FROM judging_jobs j LEFT JOIN judging_results r ON r.job_id=j.id "
                +"WHERE j.submission_id=s.id ORDER BY j.generation DESC LIMIT 1) latest ON true WHERE s.duel_id=? AND NOT s.samples_only ORDER BY s.submitted_at DESC LIMIT 300",id)) {
            boolean own=actor.id().equals(s.get("submitted_by"));
            s.put("mine",own);
            if(!own)s.remove("id");
            s.remove("submitted_by");
            feed.add(s);
        }
        result.put("feed",feed);
        if(player && "ACTIVE".equals(d.get("status"))) {
            var current=rounds.stream().filter(r->r.get("result")==null && r.get("problem_version_id")!=null).findFirst();
            if(current.isPresent()) {
                int number=((Number)current.get().get("number")).intValue();
                var mine=db.jdbc.queryForList(ROUND_SUBMISSIONS,id,number).stream().filter(s->actor.id().equals(s.get("submitted_by"))).toList();
                result.put("lockedSeconds",Math.max(0,lockedSeconds(mine,((Number)d.get("lockout_seconds")).intValue())));
            }
        }
        return result;
    }

    /** The statement of a round, available to everyone once that round has started; blind rounds hide the examples. */
    public Map<String,Object> problem(Actor actor,UUID id,int number) {
        var r=db.one("SELECT problem_version_id,modifier,forced_language FROM duel_rounds WHERE duel_id=? AND number=? AND starts_at<=clock_timestamp()",id,number);
        var problem=new LinkedHashMap<>(views.problem((UUID)r.get("problem_version_id")));
        if("BLIND".equals(r.get("modifier")) && db.exists("SELECT EXISTS(SELECT 1 FROM duel_rounds WHERE duel_id=? AND number=? AND result IS NULL)",id,number))problem.put("samples",List.of());
        if(r.get("forced_language")!=null)problem.put("languages",List.of(r.get("forced_language")));
        return problem;
    }

    /** The caller's rooms, open rooms anyone can join, and running rooms to watch. */
    public Map<String,Object> list(Actor actor) {
        String mine="EXISTS(SELECT 1 FROM duel_players p WHERE p.duel_id=d.id AND p.user_id=?)";
        return Map.of("mine",rooms(db.jdbc.queryForList(ROOM+"WHERE "+mine+" AND d.status<>'CANCELLED' ORDER BY d.created_at DESC LIMIT 30",actor.id())),
                "open",rooms(db.jdbc.queryForList(ROOM+"WHERE d.status='WAITING' AND NOT "+mine+" ORDER BY d.created_at DESC LIMIT 30",actor.id())),
                "live",rooms(db.jdbc.queryForList(ROOM+"WHERE d.status='ACTIVE' ORDER BY d.started_at DESC LIMIT 30")));
    }

    // ---------- Duel problem pool ----------

    /** Organizer view of the pool: every duel problem (hidden ones too) and approved problems not yet in it. */
    public Map<String,Object> manage(Actor actor) {
        access.organizer(actor);
        var pool=db.jdbc.queryForList("SELECT dp.problem_id,dp.problem_version_id AS id,v.title,p.slug,v.difficulty,v.version_number,dp.hidden,dp.published_at,"
                +"(SELECT count(*) FROM duel_rounds r WHERE r.problem_version_id=dp.problem_version_id AND r.result IS NOT NULL) AS rounds_played "
                +"FROM duel_problems dp JOIN problem_versions v ON v.id=dp.problem_version_id JOIN problems p ON p.id=dp.problem_id WHERE p.archived_at IS NULL ORDER BY dp.published_at DESC");
        var candidates=db.jdbc.queryForList("SELECT v.id AS version_id,v.title,p.slug,v.difficulty,v.status,v.version_number FROM problem_versions v JOIN problems p ON p.id=v.problem_id "
                +"WHERE v.status IN ('APPROVED','PUBLISHED') AND p.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM duel_problems dp WHERE dp.problem_version_id=v.id) ORDER BY v.created_at DESC LIMIT 500");
        return Map.of("pool",pool,"candidates",candidates);
    }

    /** Hides a duel problem from new rooms, or shows it again; rooms already drawn keep their rounds. */
    @Transactional
    public void update(Actor actor,UUID problem,Map<String,Object> body) {
        access.organizer(actor);
        Api.require(body.get("hidden") instanceof Boolean,HttpStatus.BAD_REQUEST,"hidden must be true or false");
        Api.require(db.jdbc.update("UPDATE duel_problems SET hidden=? WHERE problem_id=?",body.get("hidden"),problem)==1,HttpStatus.NOT_FOUND,"Not a duel problem");
        db.audit(actor.id(),"DUEL_POOL_UPDATE","problem",problem,Boolean.TRUE.equals(body.get("hidden"))?"Hidden from duels":"Shown in duels");
    }
}
