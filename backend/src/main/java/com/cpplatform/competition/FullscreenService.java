package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.cpplatform.judging.Xlsx;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import java.sql.Timestamp;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * Who left the contest screen, when and for how long. The browser reports these, so a determined
 * contestant can block them: they help the jury look into something, and they never prove it.
 */
@Service
public class FullscreenService {
    private static final Set<String> KINDS=Set.of("LEFT_FULLSCREEN","LOST_FOCUS","FULLSCREEN_REFUSED");
    private static final Set<String> REASONS=Set.of("EXITED","PAGE_RELOAD","EXIT_BUTTON","OTHER_WINDOW","BROWSER_REFUSED");
    private static final int MAX_EVENTS_PER_PERSON=2000,MAX_LOG=500,MAX_DELAY_MS=86_400_000;
    // Time away stops counting at the end of the contest, even for someone who never came back.
    private static final String AWAY="greatest(0,round(extract(epoch FROM least(coalesce(f.returned_at,now()),r.ends_at)-f.left_at)*1000))";
    private static final String EVENT="SELECT f.id,f.kind,f.reason,f.left_at,f.returned_at,f.returned_at IS NULL AS still_away,"+AWAY+" AS away_ms,u.handle,u.display_name,e.display_name AS entry_name,e.team_id IS NOT NULL AS is_team,"
            // How soon the next submission came after returning. A hint for the jury and nothing more.
            +"(SELECT round(extract(epoch FROM min(s.submitted_at)-coalesce(f.returned_at,f.left_at))) FROM submissions s WHERE s.entry_id=f.entry_id AND s.submitted_at>=coalesce(f.returned_at,f.left_at)) AS next_submission_seconds "
            +"FROM fullscreen_events f JOIN contest_runs r ON r.id=f.run_id JOIN users u ON u.id=f.user_id JOIN run_entries e ON e.id=f.entry_id ";

    private final Database db;private final Permissions access;private final ZoneId zone;
    public FullscreenService(Database db,Permissions access,@Value("${cp.display-timezone:UTC}") String zone){this.db=db;this.access=access;this.zone=ZoneId.of(zone);}

    /** A contestant's browser reporting. agoMs covers a report delayed by a lost connection. */
    public void report(Actor actor,UUID run,Map<String,Object> body) {
        String action=Api.text(body,"action",16),kind=Api.text(body,"kind",24);
        Api.require(KINDS.contains(kind),HttpStatus.BAD_REQUEST,"Invalid kind");
        Api.require(List.of("left","returned").contains(action),HttpStatus.BAD_REQUEST,"Invalid action");
        int ago=Api.number(body,"agoMs",0,0,MAX_DELAY_MS);
        var entries=db.jdbc.queryForList("SELECT entry_id FROM run_entry_members WHERE run_id=? AND user_id=?",run,actor.id());
        Api.require(!entries.isEmpty(),HttpStatus.FORBIDDEN,"You are not an entrant of this contest");
        if(action.equals("returned")) {
            db.jdbc.update("UPDATE fullscreen_events SET returned_at=greatest(left_at,now()-make_interval(secs=>?)) WHERE run_id=? AND user_id=? AND kind=? AND returned_at IS NULL",ago/1000.0,run,actor.id(),kind);
            return;
        }
        String reason=Api.optional(body,"reason","EXITED",24);
        Api.require(REASONS.contains(reason),HttpStatus.BAD_REQUEST,"Invalid reason");
        UUID id=Api.uuid(body.get("id"));
        if(((Number)db.jdbc.queryForObject("SELECT count(*) FROM fullscreen_events WHERE run_id=? AND user_id=?",Long.class,run,actor.id())).intValue()>=MAX_EVENTS_PER_PERSON)return;
        // Only while the contest is on; the database clock decides, not the laptop's.
        db.jdbc.update("INSERT INTO fullscreen_events(id,run_id,entry_id,user_id,kind,reason,left_at) "
                +"SELECT ?,r.id,?,?,?,?,greatest(r.starts_at,now()-make_interval(secs=>?)) FROM contest_runs r WHERE r.id=? AND now()-make_interval(secs=>?)<r.ends_at AND now()-make_interval(secs=>?)>=r.starts_at "
                +"ON CONFLICT DO NOTHING",id,entries.get(0).get("entry_id"),actor.id(),kind,reason,ago/1000.0,run,ago/1000.0,ago/1000.0);
    }

    private void jury(Actor actor,UUID run) {
        Api.require(access.jury(actor,(UUID)db.one("SELECT competition_id FROM contest_runs WHERE id=?",run).get("competition_id")),HttpStatus.FORBIDDEN,"Jury access required");
    }

    /** One line per person with totals, and the newest events. */
    public Map<String,Object> log(Actor actor,UUID run) {
        jury(actor,run);
        var out=new LinkedHashMap<String,Object>();
        out.put("people",people(run));
        out.put("events",db.jdbc.queryForList(EVENT+"WHERE f.run_id=? ORDER BY f.left_at DESC LIMIT "+MAX_LOG,run));
        out.put("entrants",db.jdbc.queryForObject("SELECT count(*) FROM run_entry_members WHERE run_id=?",Long.class,run));
        out.put("total",db.jdbc.queryForObject("SELECT count(*) FROM fullscreen_events WHERE run_id=?",Long.class,run));
        out.put("serverTime",Instant.now());
        return out;
    }

    private List<Map<String,Object>> people(UUID run) {
        return db.jdbc.queryForList("SELECT u.handle,u.display_name,e.display_name AS entry_name,e.team_id IS NOT NULL AS is_team,"
                +"count(*) FILTER (WHERE f.kind='LEFT_FULLSCREEN') AS left_count,count(*) FILTER (WHERE f.kind='LOST_FOCUS') AS focus_count,count(*) FILTER (WHERE f.kind='FULLSCREEN_REFUSED') AS refused_count,"
                +"count(*) FILTER (WHERE f.reason='PAGE_RELOAD') AS reload_count,"
                +"sum("+AWAY+") AS total_away_ms,max("+AWAY+") AS longest_away_ms,max(f.left_at) AS last_left_at,bool_or(f.returned_at IS NULL AND r.ends_at>now()) AS away_now "
                +"FROM fullscreen_events f JOIN contest_runs r ON r.id=f.run_id JOIN users u ON u.id=f.user_id JOIN run_entries e ON e.id=f.entry_id WHERE f.run_id=? "
                +"GROUP BY u.handle,u.display_name,e.display_name,e.team_id ORDER BY total_away_ms DESC,left_count DESC,u.handle",run);
    }

    /**
     * What the control room warns about: running contests this person helps run. A brief loss of window
     * focus happens by accident all the time, so it only counts once it has lasted a few seconds.
     */
    public Map<String,Object> alerts(Actor actor,Instant after) {
        Timestamp since=Timestamp.from(after==null?Instant.now().minusSeconds(600):after);
        String where="FROM fullscreen_events f JOIN contest_runs r ON r.id=f.run_id JOIN competitions c ON c.id=r.competition_id JOIN users u ON u.id=f.user_id JOIN run_entries e ON e.id=f.entry_id "
                +"WHERE r.status='RUNNING' AND f.left_at>? AND (f.kind<>'LOST_FOCUS' OR coalesce(f.returned_at,now())-f.left_at>interval '5 seconds') "
                +"AND (? OR c.owner_id=? OR EXISTS(SELECT 1 FROM competition_staff s WHERE s.competition_id=c.id AND s.user_id=? AND s.access_level IN ('MANAGER','JURY'))) ";
        Object[] args={since,actor.superAdmin(),actor.id(),actor.id()};
        var out=new LinkedHashMap<String,Object>();
        out.put("count",db.jdbc.queryForObject("SELECT count(*) "+where,Long.class,args));
        out.put("latest",db.jdbc.queryForList("SELECT f.id,f.kind,f.reason,f.left_at,f.returned_at,u.handle,e.display_name AS entry_name,e.team_id IS NOT NULL AS is_team,c.id AS competition_id,c.title,r.kind AS run_kind "+where+"ORDER BY f.left_at DESC LIMIT 5",args));
        out.put("serverTime",Instant.now());
        return out;
    }

    /** Excel workbook for reviewing a contest afterwards: totals per person, then every event. */
    public byte[] workbook(Actor actor,UUID run) {
        jury(actor,run);
        DateTimeFormatter format=DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(zone);
        List<List<Object>> people=new ArrayList<>();
        for(var p:people(run))people.add(new ArrayList<>(Arrays.asList(p.get("handle"),p.get("display_name"),Boolean.TRUE.equals(p.get("is_team"))?p.get("entry_name"):null,p.get("left_count"),p.get("focus_count"),p.get("reload_count"),p.get("refused_count"),seconds(p.get("total_away_ms")),seconds(p.get("longest_away_ms")),moment(format,p.get("last_left_at")))));
        List<List<Object>> events=new ArrayList<>();
        for(var e:db.jdbc.queryForList(EVENT+"WHERE f.run_id=? ORDER BY f.left_at",run))
            events.add(new ArrayList<>(Arrays.asList(moment(format,e.get("left_at")),e.get("returned_at")==null?"Did not return":moment(format,e.get("returned_at")),seconds(e.get("away_ms")),e.get("handle"),Boolean.TRUE.equals(e.get("is_team"))?e.get("entry_name"):null,label(e.get("kind")),label(e.get("reason")),e.get("next_submission_seconds"))));
        return Xlsx.write(List.of(new Xlsx.Sheet("People",List.of("Player","Name","Team","Left full screen","Lost focus","Page reloads","Full screen refused","Total away (s)","Longest away (s)","Last left at ("+zone.getId()+")"),people),
                new Xlsx.Sheet("Events",List.of("Left at ("+zone.getId()+")","Returned at","Away (s)","Player","Team","What happened","Cause","Next submission after return (s)"),events)));
    }
    private static Object seconds(Object millis){return millis==null?null:Math.round(((Number)millis).doubleValue()/100)/10.0;}
    private static String moment(DateTimeFormatter format,Object value){return value==null?null:format.format(Api.time(value));}
    private static String label(Object code){return switch(String.valueOf(code)) {
        case "LEFT_FULLSCREEN"->"Left full screen";case "LOST_FOCUS"->"Used another window";case "FULLSCREEN_REFUSED"->"Full screen refused by browser";
        case "EXITED"->"Left full screen";case "PAGE_RELOAD"->"Page reload or closed tab";case "EXIT_BUTTON"->"Exit button";case "OTHER_WINDOW"->"Another window";case "BROWSER_REFUSED"->"Browser refused";
        default->String.valueOf(code);};}
}
