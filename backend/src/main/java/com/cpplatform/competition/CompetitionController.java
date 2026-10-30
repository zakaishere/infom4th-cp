package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;
import java.time.Instant;

@RestController
public class CompetitionController {
    private final Database db;private final CompetitionService contests;private final SubmissionService submissions;
    private final Permissions access;private final StandingsService standings;private final PracticeService practice;
    private final String timeZone;
    public CompetitionController(Database db,CompetitionService contests,SubmissionService submissions,Permissions access,StandingsService standings,PracticeService practice,
                                 @org.springframework.beans.factory.annotation.Value("${cp.display-timezone:UTC}") String timeZone) {
        this.timeZone=java.time.ZoneId.of(timeZone).getId();
        this.practice=practice;
        this.db=db;this.contests=contests;this.submissions=submissions;this.access=access;this.standings=standings;
    }
    /** The clock every browser follows, so contest timing never depends on a laptop's own clock or time zone. */
    @GetMapping("/api/time")
    Object time(){return Map.of("serverTime",System.currentTimeMillis(),"timeZone",timeZone);}
    @PostMapping("/api/manage/competitions") @ResponseStatus(HttpStatus.CREATED)
    Object create(Authentication auth,@RequestBody Map<String,Object> body){return Map.of("competitionId",contests.create(Actor.of(auth),body));}
    @PatchMapping("/api/manage/competitions/{id}")
    Object edit(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body){contests.edit(Actor.of(auth),id,body);return Map.of("ok",true);}
    @DeleteMapping("/api/manage/competitions/{id}/problems/{slot}")
    Object detach(Authentication auth,@PathVariable UUID id,@PathVariable int slot){contests.detach(Actor.of(auth),id,slot);return Map.of("ok",true);}
    @GetMapping("/api/manage/competitions/{id}")
    Object managedDetail(Authentication auth,@PathVariable UUID id) {
        access.competition(Actor.of(auth),id,false);
        var result=new LinkedHashMap<>(db.one("SELECT * FROM competitions WHERE id=?",id));
        var version=contests.version(id);result.put("version",version);
        result.put("problems",db.jdbc.queryForList("SELECT * FROM competition_problems WHERE competition_version_id=? ORDER BY slot",version.get("id")));
        result.put("runs",db.jdbc.queryForList("SELECT * FROM contest_runs WHERE competition_id=? ORDER BY created_at DESC",id));return result;
    }
    @GetMapping("/api/manage/competitions")
    Object manage(Authentication auth) {
        Actor a=Actor.of(auth);access.organizer(a);
        return db.jdbc.queryForList("SELECT c.* FROM competitions c WHERE ? OR c.owner_id=? OR EXISTS(SELECT 1 FROM competition_staff s WHERE s.competition_id=c.id AND s.user_id=?) ORDER BY c.created_at DESC LIMIT 200",a.superAdmin(),a.id(),a.id());
    }
    @PostMapping("/api/manage/competitions/{id}/clone-version")
    Object cloneVersion(Authentication auth,@PathVariable UUID id){return Map.of("versionId",contests.cloneVersion(Actor.of(auth),id));}
    @PostMapping("/api/manage/competitions/{id}/problems")
    Object attach(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Integer points=body.get("points")==null?null:Api.number(body,"points",100,1,100000);
        contests.attach(Actor.of(auth),id,Api.uuid(body.get("versionId")),Api.number(body,"slot",1,1,100),Api.text(body,"label",8),points);return Map.of("ok",true);
    }
    @GetMapping("/api/manage/competitions/{id}/readiness")
    Object readiness(Authentication auth,@PathVariable UUID id) {
        access.competition(Actor.of(auth),id,false);var errors=contests.readiness(id);return Map.of("ready",errors.isEmpty(),"errors",errors);
    }
    @PostMapping("/api/manage/competitions/{id}/rehearsals") @ResponseStatus(HttpStatus.CREATED)
    Object rehearsal(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body){return Map.of("runId",contests.rehearsal(Actor.of(auth),id,body));}
    @PostMapping("/api/manage/competitions/{id}/schedule")
    Object schedule(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        // startNow: open the contest immediately; it ends after its configured duration.
        boolean now=Boolean.TRUE.equals(body.get("startNow"));
        // The placeholder start is far enough ahead that the scheduler cannot open the run before start-now does.
        UUID run=contests.schedule(Actor.of(auth),id,now?java.time.Instant.now().plusSeconds(60):Api.instant(body.get("startsAt")),Api.optional(body,"visibility","PUBLIC",16));
        if(now)contests.control(Actor.of(auth),run,Map.of("action","start-now","reason",Api.optional(body,"reason","Started immediately",2000)));
        return Map.of("runId",run);
    }
    /** Languages and whether judges can currently run them; used by problem and contest forms. */
    @GetMapping("/api/languages")
    Object languages() {
        return db.jdbc.queryForList("SELECT code,display_name,enabled FROM languages ORDER BY code");
    }
    @PostMapping("/api/manage/competitions/{id}/participants")
    Object participants(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Api.require(body.get("users") instanceof List<?> l && !l.isEmpty() && l.size()<=1000,HttpStatus.BAD_REQUEST,"Send 1-1000 handles or emails");
        return contests.registerUsers(Actor.of(auth),id,((List<?>)body.get("users")).stream().map(String::valueOf).toList());
    }
    @GetMapping("/api/manage/competitions/{id}/participants")
    Object listParticipants(Authentication auth,@PathVariable UUID id) {
        access.competition(Actor.of(auth),id,false);
        return db.jdbc.queryForList("SELECT r.id,r.status,r.created_at,u.handle,u.display_name,u.email,t.name AS team FROM registrations r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN teams t ON t.id=r.team_id WHERE r.competition_id=? ORDER BY r.created_at",id);
    }
    @GetMapping("/api/competitions")
    Object list() {
        return db.jdbc.queryForList("SELECT c.id,c.slug,c.title,c.status,r.id AS run_id,r.starts_at,r.ends_at,v.mode,v.scoring_system,v.max_team_size,"
                +"(SELECT count(*) FROM competition_problems p WHERE p.competition_version_id=v.id) AS problem_count,(SELECT count(*) FROM run_entries e WHERE e.run_id=r.id) AS entrant_count "
                +"FROM competitions c JOIN contest_runs r ON r.competition_id=c.id AND r.kind='OFFICIAL' JOIN competition_versions v ON v.id=r.competition_version_id WHERE c.published_at IS NOT NULL AND c.visibility='PUBLIC' ORDER BY r.starts_at DESC LIMIT 200");
    }
    /** Runs the caller is an entrant of, including rehearsals and unlisted/private contests. */
    @GetMapping("/api/me/runs")
    Object myRuns(Authentication auth) {
        return db.jdbc.queryForList("SELECT r.id AS run_id,r.kind,r.status,r.starts_at,r.ends_at,r.submissions_paused,c.id AS competition_id,c.slug,c.title,m.entry_id,e.display_name AS entry_name,e.team_id,(SELECT string_agg(u.handle,', ' ORDER BY u.handle) FROM run_entry_members x JOIN users u ON u.id=x.user_id WHERE x.entry_id=m.entry_id) AS members FROM run_entry_members m JOIN contest_runs r ON r.id=m.run_id JOIN competitions c ON c.id=r.competition_id JOIN run_entries e ON e.id=m.entry_id WHERE m.user_id=? ORDER BY r.starts_at DESC LIMIT 100",Actor.of(auth).id());
    }
    @PostMapping("/api/competitions/{id}/register") @ResponseStatus(HttpStatus.CREATED)
    Object register(Authentication auth,@PathVariable UUID id,@RequestBody(required=false) Map<String,Object> body) {
        UUID team=body!=null && body.get("teamId")!=null?Api.uuid(body.get("teamId")):null;
        return Map.of("registrationId",contests.register(Actor.of(auth),id,team));
    }
    @GetMapping("/api/runs/{run}")
    Object run(Authentication auth,@PathVariable UUID run) {
        Actor a=Actor.of(auth);var r=contests.runAccess(a,run,false);
        var v=db.one("SELECT c.title,v.description_md,v.rules_md,v.mode,v.duration_seconds,v.scoring_system,v.wrong_attempt_penalty_seconds,v.freeze_before_end_seconds,v.max_team_size FROM competition_versions v JOIN competitions c ON c.id=v.competition_id WHERE v.id=?",r.get("competition_version_id"));
        var result=new LinkedHashMap<String,Object>();result.put("run",r);result.put("configuration",v);result.put("serverTime",Instant.now());
        if(!Instant.now().isBefore(Api.time(r.get("starts_at"))) || access.jury(a,(UUID)r.get("competition_id")))
            result.put("problems",db.jdbc.queryForList("SELECT cp.slot,cp.label,cp.points,v.title,v.time_limit_ms,v.memory_limit_mb FROM competition_problems cp JOIN problem_versions v ON v.id=cp.problem_version_id WHERE cp.competition_version_id=? ORDER BY cp.slot",r.get("competition_version_id")));
        return result;
    }
    @GetMapping("/api/runs/{run}/problems/{slot}")
    Object problem(Authentication auth,@PathVariable UUID run,@PathVariable int slot) {
        var r=contests.runAccess(Actor.of(auth),run,true);
        UUID version=(UUID)db.one("SELECT problem_version_id FROM competition_problems WHERE competition_version_id=? AND slot=?",r.get("competition_version_id"),slot).get("problem_version_id");
        var result=safeProblem(version);
        result.put("languages",db.jdbc.queryForList("SELECT p.language_code FROM problem_version_languages p JOIN competition_version_languages c ON c.language_code=p.language_code JOIN languages l ON l.code=p.language_code WHERE p.problem_version_id=? AND c.competition_version_id=? AND l.enabled",String.class,version,r.get("competition_version_id")));return result;
    }
    Map<String,Object> safeProblem(UUID version) {
        var result=new LinkedHashMap<>(db.one("SELECT id,title,statement_md,input_format_md,output_format_md,constraints_md,explanation_md,time_limit_ms,memory_limit_mb,output_limit_kb FROM problem_versions WHERE id=?",version));
        result.put("samples",db.jdbc.queryForList("SELECT input_data,expected_output,explanation_md FROM test_cases WHERE problem_version_id=? AND is_sample ORDER BY position",version));
        result.put("languages",db.jdbc.queryForList("SELECT p.language_code FROM problem_version_languages p JOIN languages l ON l.code=p.language_code WHERE p.problem_version_id=? AND l.enabled",String.class,version));return result;
    }
    @PostMapping("/api/runs/{run}/problems/{slot}/submissions") @ResponseStatus(HttpStatus.ACCEPTED)
    Object submit(Authentication auth,@PathVariable UUID run,@PathVariable int slot,@RequestHeader("Idempotency-Key") UUID key,@RequestBody Map<String,Object> body) {
        return Map.of("submissionId",submissions.submit(Actor.of(auth),run,slot,null,key,body),"status","QUEUED");
    }
    @GetMapping("/api/runs/{run}/standings")
    Object standings(Authentication auth,@PathVariable UUID run,@RequestParam(defaultValue="false") boolean jury){return standings.get(Actor.of(auth),run,jury);}
    @GetMapping("/api/runs/{run}/events")
    Object events(Authentication auth,@PathVariable UUID run,@RequestParam(defaultValue="0") long after) {
        contests.runAccess(Actor.of(auth),run,false);
        return db.jdbc.queryForList("SELECT id,kind,created_at FROM run_events WHERE run_id=? AND id>? ORDER BY id LIMIT 100",run,Math.max(0,after));
    }
    @PostMapping("/api/manage/runs/{run}/control")
    Object control(Authentication auth,@PathVariable UUID run,@RequestBody Map<String,Object> body){contests.control(Actor.of(auth),run,body);return Map.of("ok",true);}
    /** Practice catalog with community statistics and the caller's own status per problem. */
    @GetMapping("/api/practice")
    Object practiceCatalog(Authentication auth){return Map.of("problems",practice.catalog(Actor.of(auth)),"tags",practice.allTags());}
    @GetMapping("/api/practice/{version}")
    Object practiceProblem(Authentication auth,@PathVariable UUID version) {
        var stats=practice.stats(Actor.of(auth),version);
        var result=new LinkedHashMap<String,Object>(safeProblem(version));
        result.put("stats",stats);return result;
    }
    @GetMapping("/api/manage/practice")
    Object managePractice(Authentication auth){return practice.manage(Actor.of(auth));}
    @PatchMapping("/api/manage/practice/{problem}")
    Object updatePractice(Authentication auth,@PathVariable UUID problem,@RequestBody Map<String,Object> body){practice.update(Actor.of(auth),problem,body);return Map.of("ok",true);}
    @PostMapping("/api/practice/{version}/submissions") @ResponseStatus(HttpStatus.ACCEPTED)
    Object practiceSubmit(Authentication auth,@PathVariable UUID version,@RequestHeader("Idempotency-Key") UUID key,@RequestBody Map<String,Object> body) {
        return Map.of("submissionId",submissions.submit(Actor.of(auth),null,null,version,key,body),"status","QUEUED");
    }
    @GetMapping("/api/submissions/{id}")
    Object result(Authentication auth,@PathVariable UUID id) {
        Actor actor=Actor.of(auth);var s=db.one("SELECT * FROM submissions WHERE id=?",id);
        boolean allowed=actor.id().equals(s.get("submitted_by")) || actor.superAdmin();
        if(s.get("run_id")!=null) {
            var r=contests.runAccess(actor,(UUID)s.get("run_id"),false);
            allowed=allowed || access.jury(actor,(UUID)r.get("competition_id")) || db.exists("SELECT EXISTS(SELECT 1 FROM run_entry_members WHERE entry_id=? AND user_id=?)",s.get("entry_id"),actor.id());
        }
        Api.require(allowed,HttpStatus.FORBIDDEN,"Submission access denied");
        var result=new LinkedHashMap<String,Object>();
        result.put("submission",s);
        var judging=db.jdbc.queryForList("SELECT j.id AS job_id,j.generation,j.status,j.last_error_code,r.verdict,r.execution_time_ms,r.peak_memory_kb,r.passed_tests,r.total_tests,r.public_feedback FROM judging_jobs j LEFT JOIN judging_results r ON r.job_id=j.id WHERE j.submission_id=? ORDER BY j.generation DESC LIMIT 1",id);
        result.put("judging",judging);
        // Per-test verdicts in test order. Hidden test content is never returned; tests after an
        // early stop are reported as not run. Sample tests are marked so contestants can retry them locally.
        if(!judging.isEmpty() && judging.get(0).get("verdict")!=null)
            result.put("cases",db.jdbc.queryForList("SELECT row_number() OVER (ORDER BY g.position,t.position) AS number,t.is_sample AS sample,c.verdict,c.execution_time_ms,c.peak_memory_kb FROM test_cases t JOIN test_case_groups g ON g.id=t.group_id LEFT JOIN test_case_results c ON c.test_case_id=t.id AND c.job_id=? WHERE t.problem_version_id=? AND (t.is_sample OR NOT ?) ORDER BY g.position,t.position",
                    judging.get(0).get("job_id"),s.get("problem_version_id"),Boolean.TRUE.equals(s.get("samples_only"))));
        return result;
    }
    @GetMapping("/api/submissions")
    Object history(Authentication auth,@RequestParam(required=false) UUID run,@RequestParam(defaultValue="0") int offset) {
        Api.require(offset>=0 && offset<=1000000,HttpStatus.BAD_REQUEST,"Invalid offset");
        return db.jdbc.queryForList("SELECT s.id,s.context,s.run_id,s.problem_slot,s.problem_version_id,s.language_code,s.samples_only,s.submitted_at,latest.status,latest.verdict,latest.execution_time_ms,latest.peak_memory_kb,latest.passed_tests,latest.total_tests,u.handle AS submitted_by_handle FROM submissions s JOIN users u ON u.id=s.submitted_by "
                +"LEFT JOIN LATERAL (SELECT j.status,r.verdict,r.execution_time_ms,r.peak_memory_kb,r.passed_tests,r.total_tests FROM judging_jobs j LEFT JOIN judging_results r ON r.job_id=j.id WHERE j.submission_id=s.id ORDER BY j.generation DESC LIMIT 1) latest ON true "
                // Team entries see every member's submissions for the runs they share.
                +"WHERE s.context<>'BENCHMARK' AND (s.submitted_by=? OR s.entry_id IN (SELECT m.entry_id FROM run_entry_members m WHERE m.user_id=?)) AND (?::uuid IS NULL OR s.run_id=?::uuid) ORDER BY s.submitted_at DESC LIMIT 100 OFFSET ?",Actor.of(auth).id(),Actor.of(auth).id(),run,run,offset);
    }
    /** Jury submission monitor for one run; source is fetched separately through /api/submissions/{id}. */
    @GetMapping("/api/manage/runs/{run}/submissions")
    Object jurySubmissions(Authentication auth,@PathVariable UUID run,@RequestParam(defaultValue="0") int offset) {
        Actor actor=Actor.of(auth);var r=db.one("SELECT competition_id FROM contest_runs WHERE id=?",run);
        Api.require(access.jury(actor,(UUID)r.get("competition_id")),HttpStatus.FORBIDDEN,"Jury access required");
        Api.require(offset>=0 && offset<=1000000,HttpStatus.BAD_REQUEST,"Invalid offset");
        return db.jdbc.queryForList("SELECT s.id,s.entry_id,e.display_name AS entry_name,u.handle,s.problem_slot,s.language_code,s.submitted_at,latest.status,latest.verdict,latest.execution_time_ms,latest.peak_memory_kb,latest.passed_tests,latest.total_tests,latest.generation FROM submissions s "
                +"JOIN run_entries e ON e.id=s.entry_id JOIN users u ON u.id=s.submitted_by "
                +"LEFT JOIN LATERAL (SELECT j.status,j.generation,res.verdict,res.execution_time_ms,res.peak_memory_kb,res.passed_tests,res.total_tests FROM judging_jobs j LEFT JOIN judging_results res ON res.job_id=j.id WHERE j.submission_id=s.id ORDER BY j.generation DESC LIMIT 1) latest ON true "
                +"WHERE s.run_id=? ORDER BY s.submitted_at DESC LIMIT 100 OFFSET ?",run,offset);
    }
}
