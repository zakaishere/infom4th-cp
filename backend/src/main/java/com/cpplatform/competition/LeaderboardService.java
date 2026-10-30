package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.*;

/**
 * Global Sigma leaderboards. A problem pays once per player and once per team: its difficulty value
 * plus a rarity bonus of up to 50% that shrinks as more of the community solves it, so scores keep moving.
 * Contest solves count only after the results are public, so this board can never reveal a frozen scoreboard.
 */
@Service
public class LeaderboardService {
    public static final Map<String,Integer> VALUES=Map.of("EASY",100,"MEDIUM",200,"HARD",400);
    private static final List<String> DIFFICULTIES=List.of("EASY","MEDIUM","HARD");
    private static final long CACHE_MILLIS=30000;
    /** One accepted submission; team is set when it was made for a team entry. */
    public record Solve(UUID user,UUID problem,String difficulty,Instant at,UUID team) {}
    public record Membership(UUID user,UUID team,Instant joinedAt) {}
    public record Row(UUID key,int rank,long score,int solved,int easy,int medium,int hard,Instant lastSolvedAt) {}
    public record Board(List<Row> players,List<Row> teams,Instant computedAt) {}

    /** Sigma tiers, lowest first, as the score each one starts at. */
    public static final List<Map.Entry<String,Integer>> TIERS=List.of(Map.entry("Digit",0),Map.entry("Variable",500),Map.entry("Lemma",1500),Map.entry("Theorem",4000),Map.entry("Infinity",8000));
    public static String tier(long score) {
        String name=TIERS.get(0).getKey();
        for(var t:TIERS)if(score>=t.getValue())name=t.getKey();
        return name;
    }
    /** Joins and condition for submissions anyone may count: real practice runs and contests whose results are public. Needs aliases s and v. */
    public static final String COUNTED_JOINS="LEFT JOIN practice_publications pp ON pp.problem_id=v.problem_id LEFT JOIN run_entries e ON e.id=s.entry_id "
            +"LEFT JOIN contest_runs r ON r.id=s.run_id LEFT JOIN competitions c ON c.id=r.competition_id LEFT JOIN competition_versions cv ON cv.id=r.competition_version_id ";
    public static final String COUNTED="((s.context='PRACTICE' AND NOT s.samples_only AND pp.problem_id IS NOT NULL AND NOT pp.hidden) OR (s.context='CONTEST' AND "+ContestResults.PUBLIC_FINAL+"))";
    private static final String ACCEPTED="SELECT s.submitted_by AS user_id,v.problem_id,v.difficulty,s.submitted_at,e.team_id FROM submissions s "
            +"JOIN problem_versions v ON v.id=s.problem_version_id JOIN users u ON u.id=s.submitted_by AND u.status='ACTIVE' "+COUNTED_JOINS
            // A rejudge in progress keeps the last completed verdict, as standings do.
            +"JOIN LATERAL (SELECT jr.verdict FROM judging_jobs j JOIN judging_results jr ON jr.job_id=j.id WHERE j.submission_id=s.id AND j.status='COMPLETED' ORDER BY j.generation DESC LIMIT 1) latest ON latest.verdict='ACCEPTED' "
            // Staff can read hidden tests, so their solves would not be a fair score.
            +"WHERE NOT EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=s.submitted_by AND ur.role_code IN ('SUPER_ADMIN','ADMIN','MODERATOR')) AND "+COUNTED;

    private record Cached(long until,Board board,Map<UUID,Map<String,Object>> players,Map<UUID,Map<String,Object>> teams) {}
    private volatile Cached cached;
    private final Database db;
    public LeaderboardService(Database db){this.db=db;}

    /** Top 100 of both boards plus the caller's own places, which may be further down. */
    public Map<String,Object> get(Actor actor) {
        var current=current();
        var myTeams=db.jdbc.queryForList("SELECT team_id FROM team_members WHERE user_id=?",UUID.class,actor.id()).stream()
                .map(current.teams::get).filter(Objects::nonNull).sorted(Comparator.comparingInt(t->(Integer)t.get("rank"))).toList();
        var result=new LinkedHashMap<String,Object>();
        result.put("players",current.players.values().stream().limit(100).toList());
        result.put("teams",current.teams.values().stream().limit(100).toList());
        result.put("playerCount",current.players.size());
        result.put("teamCount",current.teams.size());
        result.put("me",current.players.get(actor.id()));
        result.put("myTeams",myTeams);
        result.put("values",VALUES);
        result.put("tiers",TIERS.stream().map(t->Map.of("name",t.getKey(),"from",t.getValue())).toList());
        result.put("computedAt",current.board.computedAt());
        return result;
    }
    private synchronized Cached current() {
        long now=System.currentTimeMillis();
        if(cached==null || cached.until<=now)cached=load(now);
        return cached;
    }
    /** A player's board row, or null when unranked. */
    public Map<String,Object> player(UUID user){return current().players.get(user);}
    /** A team's board row, or null when unranked. */
    public Map<String,Object> team(UUID team){return current().teams.get(team);}
    public int playerCount(){return current().players.size();}
    public int teamCount(){return current().teams.size();}
    public synchronized void invalidate(){cached=null;}

    private Cached load(long now) {
        var board=compute();
        var names=new HashMap<UUID,Map<String,Object>>();
        for(var u:db.jdbc.queryForList("SELECT id,handle,display_name FROM users"))names.put((UUID)u.get("id"),u);
        var teamNames=new HashMap<UUID,Map<String,Object>>();
        for(var t:db.jdbc.queryForList("SELECT t.id,t.name,(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=t.id) AS members FROM teams t"))teamNames.put((UUID)t.get("id"),t);
        var players=new LinkedHashMap<UUID,Map<String,Object>>();
        for(Row row:board.players()) {
            var out=row(row);out.put("handle",names.get(row.key()).get("handle"));out.put("display_name",names.get(row.key()).get("display_name"));out.put("tier",tier(row.score()));
            players.put(row.key(),out);
        }
        var teams=new LinkedHashMap<UUID,Map<String,Object>>();
        for(Row row:board.teams()) {
            var out=row(row);out.put("id",row.key());out.put("name",teamNames.get(row.key()).get("name"));out.put("members",teamNames.get(row.key()).get("members"));
            teams.put(row.key(),out);
        }
        return new Cached(now+CACHE_MILLIS,board,players,teams);
    }

    /** Emails and user IDs stay out: this is what every signed-in user can read. */
    private static Map<String,Object> row(Row row) {
        var out=new LinkedHashMap<String,Object>();
        out.put("rank",row.rank());out.put("score",row.score());out.put("solved",row.solved());
        out.put("easy",row.easy());out.put("medium",row.medium());out.put("hard",row.hard());out.put("last_solved_at",row.lastSolvedAt());
        return out;
    }

    public Board compute() {
        var solves=db.jdbc.queryForList(ACCEPTED).stream().map(s->new Solve((UUID)s.get("user_id"),(UUID)s.get("problem_id"),(String)s.get("difficulty"),Api.time(s.get("submitted_at")),(UUID)s.get("team_id"))).toList();
        var members=db.jdbc.queryForList("SELECT user_id,team_id,joined_at FROM team_members").stream().map(m->new Membership((UUID)m.get("user_id"),(UUID)m.get("team_id"),Api.time(m.get("joined_at")))).toList();
        return calculate(solves,members,Instant.now());
    }

    /** Rarity is measured among players who have solved anything, so it needs no list of idle accounts. */
    public static Board calculate(List<Solve> solves,List<Membership> members,Instant now) {
        Map<UUID,Set<UUID>> solvers=new HashMap<>();Map<UUID,String> difficulty=new HashMap<>();Set<UUID> everyone=new HashSet<>();
        for(Solve s:solves) {
            solvers.computeIfAbsent(s.problem(),k->new HashSet<>()).add(s.user());everyone.add(s.user());
            // A problem whose versions were rated differently pays its hardest rating.
            difficulty.merge(s.problem(),s.difficulty(),(a,b)->DIFFICULTIES.indexOf(a)>=DIFFICULTIES.indexOf(b)?a:b);
        }
        Map<UUID,Long> value=new HashMap<>();
        for(var problem:solvers.entrySet())value.put(problem.getKey(),value(difficulty.get(problem.getKey()),problem.getValue().size(),everyone.size()));
        Map<UUID,Map<UUID,Instant>> players=new HashMap<>(),teams=new HashMap<>();
        Map<UUID,List<Membership>> byUser=new HashMap<>();
        for(Membership m:members)byUser.computeIfAbsent(m.user(),k->new ArrayList<>()).add(m);
        for(Solve s:solves) {
            credit(players,s.user(),s);
            if(s.team()!=null)credit(teams,s.team(),s);
            // Joining a team never carries points earned before joining.
            for(Membership m:byUser.getOrDefault(s.user(),List.of()))if(!s.at().isBefore(m.joinedAt()))credit(teams,m.team(),s);
        }
        return new Board(rank(players,value,difficulty),rank(teams,value,difficulty),now);
    }

    static long value(String difficulty,int solvers,int everyone) {
        double rarity=1-(double)solvers/everyone;
        return Math.round(VALUES.get(difficulty)*(1+0.5*rarity)/5)*5;
    }

    private static void credit(Map<UUID,Map<UUID,Instant>> board,UUID key,Solve s) {
        board.computeIfAbsent(key,k->new HashMap<>()).merge(s.problem(),s.at(),(a,b)->a.isBefore(b)?a:b);
    }

    /** Equal scores: whoever reached the score first is ahead. */
    private static List<Row> rank(Map<UUID,Map<UUID,Instant>> board,Map<UUID,Long> value,Map<UUID,String> difficulty) {
        List<Row> rows=new ArrayList<>();
        for(var entry:board.entrySet()) {
            long score=0;int[] count=new int[3];Instant last=Instant.MIN;
            for(var solved:entry.getValue().entrySet()) {
                score+=value.get(solved.getKey());count[DIFFICULTIES.indexOf(difficulty.get(solved.getKey()))]++;
                if(solved.getValue().isAfter(last))last=solved.getValue();
            }
            rows.add(new Row(entry.getKey(),0,score,entry.getValue().size(),count[0],count[1],count[2],last));
        }
        rows.sort(Comparator.comparingLong(Row::score).reversed().thenComparing(Row::lastSolvedAt).thenComparing(Row::key));
        List<Row> ranked=new ArrayList<>();
        for(Row r:rows)ranked.add(new Row(r.key(),ranked.size()+1,r.score(),r.solved(),r.easy(),r.medium(),r.hard(),r.lastSolvedAt()));
        return ranked;
    }
}
