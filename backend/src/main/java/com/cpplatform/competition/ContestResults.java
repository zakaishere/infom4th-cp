package com.cpplatform.competition;

import com.cpplatform.common.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Instant;
import java.util.*;

/**
 * Saved final results of public contests, the rating built from them, and contest replays.
 * Everything here reads only contests whose results are already public (PUBLIC_FINAL).
 */
@Service
public class ContestResults {
    /** Public official contests that have ended, with any frozen scoreboard already released. Needs aliases r, c and cv. */
    public static final String PUBLIC_FINAL="r.kind='OFFICIAL' AND r.status IN ('FINISHED','ARCHIVED') AND c.published_at IS NOT NULL AND c.visibility='PUBLIC' "
            +"AND (cv.freeze_before_end_seconds=0 OR r.final_standings_released_at IS NOT NULL)";
    public static final String RUN_JOINS="JOIN contest_runs r ON r.id=cr.run_id JOIN competitions c ON c.id=r.competition_id JOIN competition_versions cv ON cv.id=r.competition_version_id ";
    private static final long CACHE_MILLIS=30000,REPLAY_CACHE_MILLIS=300000;
    private static final int BUZZER_SECONDS=60,CLEAN_SHEET_MIN_PROBLEMS=3,REPLAY_POINTS=60;

    public record Result(UUID entry,int rank,int solved,double score,Long penalty,int submissions,int firstBloods,boolean cleanSheet,boolean buzzerBeater,boolean freezeBreaker) {}
    public record RatingPoint(UUID run,String title,Instant at,int rating,int delta,int rank,int entrants) {}
    public record Replay(Map<UUID,List<Integer>> ranks,List<Long> seconds,Map<UUID,List<Map<String,Object>>> solves,long durationSeconds,int entrants) {}
    private record CachedRatings(long until,Map<UUID,List<RatingPoint>> history) {}
    private record CachedReplay(long until,Replay replay) {}

    private final Database db;private final StandingsService standings;private final TransactionTemplate transaction;
    private volatile CachedRatings ratings;
    private final Map<UUID,CachedReplay> replays=new HashMap<>();
    public ContestResults(Database db,StandingsService standings,PlatformTransactionManager transactions) {
        this.db=db;this.standings=standings;this.transaction=new TransactionTemplate(transactions);
    }

    /** Rating history per user, oldest first. Also the moment saved results catch up with finished contests and rejudges. */
    public synchronized Map<UUID,List<RatingPoint>> ratings() {
        long now=System.currentTimeMillis();
        if(ratings==null || ratings.until<=now) {
            sync();
            ratings=new CachedRatings(now+CACHE_MILLIS,loadRatings());
        }
        return ratings.history;
    }
    /** Latest rating of one user, or null before their first rated contest. */
    public Integer rating(UUID user) {
        var points=ratings().get(user);
        return points==null || points.isEmpty()?null:points.get(points.size()-1).rating();
    }
    public synchronized void invalidate(){ratings=null;replays.clear();}

    private void sync() {
        // The minute of overlap covers a verdict committed while the previous rebuild was reading.
        var stale=db.jdbc.queryForList("SELECT r.id FROM contest_runs r JOIN competitions c ON c.id=r.competition_id JOIN competition_versions cv ON cv.id=r.competition_version_id "
                +"LEFT JOIN contest_result_runs t ON t.run_id=r.id WHERE "+PUBLIC_FINAL+" AND (t.run_id IS NULL OR EXISTS(SELECT 1 FROM submissions s JOIN judging_jobs j ON j.submission_id=s.id JOIN judging_results jr ON jr.job_id=j.id "
                +"WHERE s.run_id=r.id AND jr.judged_at>t.computed_at-interval '1 minute'))",UUID.class);
        for(UUID run:stale)transaction.executeWithoutResult(status->rebuild(run));
    }

    private void rebuild(UUID run) {
        // Several API instances may notice the same contest at once.
        db.jdbc.queryForList("SELECT pg_advisory_xact_lock(hashtext('contest_results'))");
        var r=db.one("SELECT r.*,cv.freeze_before_end_seconds FROM contest_runs r JOIN competition_versions cv ON cv.id=r.competition_version_id WHERE r.id=?",run);
        var input=standings.input(run,db.one("SELECT * FROM competition_versions WHERE id=?",r.get("competition_version_id")));
        Instant starts=Api.time(r.get("starts_at")),ends=Api.time(r.get("ends_at"));
        long freeze=((Number)r.get("freeze_before_end_seconds")).longValue();
        var finalBoard=standings.board(input,starts,null);
        var frozenBoard=freeze>0?standings.board(input,starts,ends.minusSeconds(freeze)):null;
        db.jdbc.update("DELETE FROM contest_results WHERE run_id=?",run);
        db.jdbc.update("INSERT INTO contest_result_runs(run_id) VALUES (?) ON CONFLICT(run_id) DO UPDATE SET computed_at=now()",run);
        int entrants=finalBoard.rows().size();
        for(Result x:summarize(finalBoard,frozenBoard,input.submissions(),ends))
            db.jdbc.update("INSERT INTO contest_results(run_id,entry_id,rank,entrants,solved,score,penalty_seconds,submissions,first_bloods,clean_sheet,buzzer_beater,freeze_breaker) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    run,x.entry(),x.rank(),entrants,x.solved(),x.score(),x.penalty(),x.submissions(),x.firstBloods(),x.cleanSheet(),x.buzzerBeater(),x.freezeBreaker());
    }

    /** One contest's results with what each entry earned: first solves, flawless runs, last-minute solves and the biggest climb after the freeze. */
    public static List<Result> summarize(ContestScoring.Board board,ContestScoring.Board frozen,List<ContestScoring.Submission> submissions,Instant ends) {
        Map<Integer,ContestScoring.Submission> first=new HashMap<>();Map<UUID,Integer> count=new HashMap<>();Set<UUID> buzzer=new HashSet<>();
        Comparator<ContestScoring.Submission> order=Comparator.comparing(ContestScoring.Submission::submitted).thenComparing(ContestScoring.Submission::id);
        for(var s:submissions) {
            count.merge(s.entry(),1,Integer::sum);
            if(!"ACCEPTED".equals(s.verdict()))continue;
            first.merge(s.slot(),s,(a,b)->order.compare(a,b)<=0?a:b);
            if(!s.submitted().isBefore(ends.minusSeconds(BUZZER_SECONDS)))buzzer.add(s.entry());
        }
        Map<UUID,Integer> firstBloods=new HashMap<>();
        for(var s:first.values())firstBloods.merge(s.entry(),1,Integer::sum);
        Map<UUID,Integer> climbs=new HashMap<>();int bestClimb=0;
        if(frozen!=null) {
            Map<UUID,Integer> before=new HashMap<>();
            for(var row:frozen.rows())before.put(row.entry(),row.rank());
            for(var row:board.rows()) {
                int climb=before.getOrDefault(row.entry(),row.rank())-row.rank();
                climbs.put(row.entry(),climb);bestClimb=Math.max(bestClimb,climb);
            }
        }
        List<Result> results=new ArrayList<>();
        for(var row:board.rows()) {
            boolean clean=row.problems().size()>=CLEAN_SHEET_MIN_PROBLEMS && row.problems().stream().allMatch(c->c.solved() && c.attempts()==1);
            results.add(new Result(row.entry(),row.rank(),row.solved(),row.score(),row.penaltySeconds(),count.getOrDefault(row.entry(),0),firstBloods.getOrDefault(row.entry(),0),
                    clean,buzzer.contains(row.entry()),bestClimb>0 && climbs.getOrDefault(row.entry(),0)==bestClimb));
        }
        return results;
    }

    private Map<UUID,List<RatingPoint>> loadRatings() {
        var rows=db.jdbc.queryForList("SELECT cr.run_id,c.title,r.starts_at,cr.entry_id,cr.rank,cr.entrants,m.user_id FROM contest_results cr "+RUN_JOINS
                +"JOIN run_entry_members m ON m.entry_id=cr.entry_id WHERE "+PUBLIC_FINAL+" AND c.rated AND cr.submissions>0 "
                // Staff can read the tests, so an entry with staff in it plays no part in the rating.
                +"AND NOT EXISTS(SELECT 1 FROM run_entry_members x JOIN user_roles ur ON ur.user_id=x.user_id WHERE x.entry_id=cr.entry_id AND ur.role_code IN ('SUPER_ADMIN','ADMIN','MODERATOR')) "
                +"ORDER BY r.starts_at,cr.run_id,cr.rank,cr.entry_id");
        Map<UUID,Map<UUID,List<UUID>>> members=new LinkedHashMap<>();Map<UUID,Map<UUID,Map<String,Object>>> info=new HashMap<>();
        for(var row:rows) {
            UUID run=(UUID)row.get("run_id"),entry=(UUID)row.get("entry_id");
            members.computeIfAbsent(run,k->new LinkedHashMap<>()).computeIfAbsent(entry,k->new ArrayList<>()).add((UUID)row.get("user_id"));
            info.computeIfAbsent(run,k->new HashMap<>()).put(entry,row);
        }
        List<Rating.Contest> contests=new ArrayList<>();
        for(var run:members.entrySet()) {
            List<Rating.Entrant> entrants=new ArrayList<>();
            for(var entry:run.getValue().entrySet())entrants.add(new Rating.Entrant(entry.getKey(),((Number)info.get(run.getKey()).get(entry.getKey()).get("rank")).intValue(),entry.getValue()));
            contests.add(new Rating.Contest(run.getKey(),entrants));
        }
        Map<UUID,List<RatingPoint>> history=new HashMap<>();
        for(var user:Rating.calculate(contests).entrySet()) {
            List<RatingPoint> points=new ArrayList<>();
            for(var change:user.getValue()) {
                var row=info.get(change.run()).get(change.entry());
                points.add(new RatingPoint(change.run(),(String)row.get("title"),Api.time(row.get("starts_at")),change.after(),change.after()-change.before(),((Number)row.get("rank")).intValue(),((Number)row.get("entrants")).intValue()));
            }
            history.put(user.getKey(),points);
        }
        return history;
    }

    /** Everyone's rank through a finished public contest, sampled across its length, with each entry's solves. */
    public synchronized Replay replay(UUID run) {
        long now=System.currentTimeMillis();
        var cached=replays.get(run);
        if(cached!=null && cached.until>now)return cached.replay;
        var r=db.one("SELECT * FROM contest_runs WHERE id=?",run);
        var input=standings.input(run,db.one("SELECT * FROM competition_versions WHERE id=?",r.get("competition_version_id")));
        Instant starts=Api.time(r.get("starts_at")),ends=Api.time(r.get("ends_at"));
        long duration=Math.max(1,ends.getEpochSecond()-starts.getEpochSecond());
        List<Long> seconds=new ArrayList<>();Map<UUID,List<Integer>> ranks=new HashMap<>();
        for(int i=1;i<=REPLAY_POINTS;i++) {
            long at=duration*i/REPLAY_POINTS;seconds.add(at);
            // The last point sits just past the end, so it includes a solve in the final second.
            for(var row:standings.board(input,starts,starts.plusSeconds(at+(i==REPLAY_POINTS?1:0))).rows())ranks.computeIfAbsent(row.entry(),k->new ArrayList<>()).add(row.rank());
        }
        Map<Integer,Object> labels=new HashMap<>();
        for(var p:input.problems())labels.put(((Number)p.get("slot")).intValue(),p.get("label"));
        Map<UUID,List<Map<String,Object>>> solves=new HashMap<>();
        for(var row:standings.board(input,starts,null).rows())for(var cell:row.problems())if(cell.solved())
            solves.computeIfAbsent(row.entry(),k->new ArrayList<>()).add(Map.of("seconds",cell.solveSeconds(),"label",labels.get(cell.slot())));
        var replay=new Replay(ranks,seconds,solves,duration,input.entries().size());
        if(replays.size()>50)replays.values().removeIf(c->c.until<=now);
        replays.put(run,new CachedReplay(now+REPLAY_CACHE_MILLIS,replay));
        return replay;
    }
}
