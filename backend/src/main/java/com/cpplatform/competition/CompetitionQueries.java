package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.stereotype.Service;
import java.util.*;
import java.time.Instant;

/** Read-only views of competitions and runs, for organizers and contestants. Changes go through CompetitionService. */
@Service
public class CompetitionQueries {
    private final Database db;private final CompetitionService contests;private final Permissions access;
    public CompetitionQueries(Database db,CompetitionService contests,Permissions access){this.db=db;this.contests=contests;this.access=access;}

    /** A competition with its current version, problems and runs, for its organizers. */
    public Map<String,Object> managed(Actor actor,UUID competition) {
        access.competition(actor,competition,false);
        var result=new LinkedHashMap<>(db.one("SELECT * FROM competitions WHERE id=?",competition));
        var version=contests.version(competition);result.put("version",version);
        result.put("problems",db.jdbc.queryForList("SELECT * FROM competition_problems WHERE competition_version_id=? ORDER BY slot",version.get("id")));
        result.put("runs",db.jdbc.queryForList("SELECT * FROM contest_runs WHERE competition_id=? ORDER BY created_at DESC",competition));return result;
    }
    /** Competitions the organizer owns or staffs; every competition for a super administrator. */
    public List<Map<String,Object>> managed(Actor actor) {
        access.organizer(actor);
        return db.jdbc.queryForList("SELECT c.* FROM competitions c WHERE ? OR c.owner_id=? OR EXISTS(SELECT 1 FROM competition_staff s WHERE s.competition_id=c.id AND s.user_id=?) ORDER BY c.created_at DESC LIMIT 200",actor.superAdmin(),actor.id(),actor.id());
    }
    public List<Map<String,Object>> participants(Actor actor,UUID competition) {
        access.competition(actor,competition,false);
        return db.jdbc.queryForList("SELECT r.id,r.status,r.created_at,u.handle,u.display_name,u.email,t.name AS team FROM registrations r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN teams t ON t.id=r.team_id WHERE r.competition_id=? ORDER BY r.created_at",competition);
    }
    /** Languages and whether judges can currently run them; used by problem and contest forms. */
    public List<Map<String,Object>> languages() {
        return db.jdbc.queryForList("SELECT code,display_name,enabled FROM languages ORDER BY code");
    }
    /** Published public competitions with their official run. */
    public List<Map<String,Object>> published() {
        return db.jdbc.queryForList("SELECT c.id,c.slug,c.title,c.status,r.id AS run_id,r.starts_at,r.ends_at,v.mode,v.scoring_system,v.max_team_size,"
                +"(SELECT count(*) FROM competition_problems p WHERE p.competition_version_id=v.id) AS problem_count,(SELECT count(*) FROM run_entries e WHERE e.run_id=r.id) AS entrant_count "
                +"FROM competitions c JOIN contest_runs r ON r.competition_id=c.id AND r.kind='OFFICIAL' JOIN competition_versions v ON v.id=r.competition_version_id WHERE c.published_at IS NOT NULL AND c.visibility='PUBLIC' ORDER BY r.starts_at DESC LIMIT 200");
    }
    /** Runs the actor is an entrant of, including rehearsals and unlisted/private contests. */
    public List<Map<String,Object>> runsOf(Actor actor) {
        return db.jdbc.queryForList("SELECT r.id AS run_id,r.kind,r.status,r.starts_at,r.ends_at,r.submissions_paused,c.id AS competition_id,c.slug,c.title,m.entry_id,e.display_name AS entry_name,e.team_id,(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM run_entry_members x JOIN users u ON u.id=x.user_id WHERE x.entry_id=m.entry_id) AS members FROM run_entry_members m JOIN contest_runs r ON r.id=m.run_id JOIN competitions c ON c.id=r.competition_id JOIN run_entries e ON e.id=m.entry_id WHERE m.user_id=? ORDER BY r.starts_at DESC LIMIT 100",actor.id());
    }
    /** A run, its configuration and, once it has started (or for the jury), its problems. */
    public Map<String,Object> run(Actor actor,UUID run) {
        var r=contests.runAccess(actor,run,false);
        var v=db.one("SELECT c.title,v.description_md,v.rules_md,v.mode,v.duration_seconds,v.scoring_system,v.wrong_attempt_penalty_seconds,v.freeze_before_end_seconds,v.max_team_size FROM competition_versions v JOIN competitions c ON c.id=v.competition_id WHERE v.id=?",r.get("competition_version_id"));
        var result=new LinkedHashMap<String,Object>();result.put("run",r);result.put("configuration",v);result.put("serverTime",Instant.now());
        if(!Instant.now().isBefore(Api.time(r.get("starts_at"))) || access.jury(actor,(UUID)r.get("competition_id")))
            result.put("problems",db.jdbc.queryForList("SELECT cp.slot,cp.label,cp.points,v.title,v.time_limit_ms,v.memory_limit_mb FROM competition_problems cp JOIN problem_versions v ON v.id=cp.problem_version_id WHERE cp.competition_version_id=? ORDER BY cp.slot",r.get("competition_version_id")));
        return result;
    }
    /** A released problem of a run, with only the languages both the problem and the contest allow. */
    public Map<String,Object> runProblem(Actor actor,UUID run,int slot) {
        var r=contests.runAccess(actor,run,true);
        UUID version=(UUID)db.one("SELECT problem_version_id FROM competition_problems WHERE competition_version_id=? AND slot=?",r.get("competition_version_id"),slot).get("problem_version_id");
        var result=problem(version);
        result.put("languages",db.jdbc.queryForList("SELECT p.language_code FROM problem_version_languages p JOIN competition_version_languages c ON c.language_code=p.language_code JOIN languages l ON l.code=p.language_code WHERE p.problem_version_id=? AND c.competition_version_id=? AND l.enabled",String.class,version,r.get("competition_version_id")));return result;
    }
    /** What a contestant may see of a problem version: the statement, limits and sample tests only. */
    public Map<String,Object> problem(UUID version) {
        var result=new LinkedHashMap<>(db.one("SELECT id,title,statement_md,input_format_md,output_format_md,constraints_md,explanation_md,time_limit_ms,memory_limit_mb,output_limit_kb,function_signature FROM problem_versions WHERE id=?",version));
        result.put("samples",db.jdbc.queryForList("SELECT input_data,expected_output,explanation_md FROM test_cases WHERE problem_version_id=? AND is_sample ORDER BY position",version));
        result.put("languages",db.jdbc.queryForList("SELECT p.language_code FROM problem_version_languages p JOIN languages l ON l.code=p.language_code WHERE p.problem_version_id=? AND l.enabled",String.class,version));return result;
    }
    public List<Map<String,Object>> events(Actor actor,UUID run,long after) {
        contests.runAccess(actor,run,false);
        return db.jdbc.queryForList("SELECT id,kind,created_at FROM run_events WHERE run_id=? AND id>? ORDER BY id LIMIT 100",run,Math.max(0,after));
    }
}
