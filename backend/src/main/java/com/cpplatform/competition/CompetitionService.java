package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import com.cpplatform.laboratory.LaboratoryService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import java.util.*;
import java.time.Instant;
import java.sql.Timestamp;

@Service
public class CompetitionService {
    private final Database db;private final Permissions access;private final LaboratoryService lab;
    public CompetitionService(Database db,Permissions access,LaboratoryService lab){this.db=db;this.access=access;this.lab=lab;}
    @Transactional
    public UUID create(Actor actor,Map<String,Object> body) {
        access.organizer(actor);
        UUID id=db.id("INSERT INTO competitions(slug,title,owner_id) VALUES (?,?,?) RETURNING id",Api.text(body,"slug",120),Api.text(body,"title",255),actor.id());
        String mode=Api.optional(body,"mode","INDIVIDUAL",16);
        Api.require(List.of("INDIVIDUAL","TEAM").contains(mode),HttpStatus.BAD_REQUEST,"Invalid competition mode");
        int size=mode.equals("TEAM")?Api.number(body,"maxTeamSize",3,1,10):1;
        String scoring=scoring(body,"ICPC");
        UUID version=db.id("INSERT INTO competition_versions(competition_id,version_number,duration_seconds,mode,max_team_size,description_md,rules_md,wrong_attempt_penalty_seconds,penalize_compilation_errors,freeze_before_end_seconds,created_by,scoring_system) VALUES (?,1,?,?,?,?,?,?,?,?,?,?) RETURNING id",
                id,Api.number(body,"durationSeconds",10800,60,86400),mode,size,Api.optional(body,"description","",262144),
                Api.optional(body,"rules","",262144),Api.number(body,"wrongAttemptPenaltySeconds",1200,0,86400),
                Boolean.TRUE.equals(body.get("penalizeCompilationErrors")),Api.number(body,"freezeBeforeEndSeconds",0,0,86399),actor.id(),scoring);
        for(String language:Api.languages(body))db.jdbc.update("INSERT INTO competition_version_languages VALUES (?,?)",version,language);
        db.audit(actor.id(),"COMPETITION_CREATE","competition",id,null);return id;
    }
    static String scoring(Map<String,Object> body,String fallback) {
        String value=Api.optional(body,"scoringSystem",fallback,16);
        Api.require(ContestScoring.SYSTEMS.contains(value),HttpStatus.BAD_REQUEST,"Scoring must be one of "+ContestScoring.SYSTEMS);
        return value;
    }
    @Transactional
    public void edit(Actor actor,UUID competition,Map<String,Object> body) {
        access.competition(actor,competition,false);
        var c=db.one("SELECT status FROM competitions WHERE id=? FOR UPDATE",competition);
        Api.require(List.of("DRAFT","INTERNAL_TESTING","READY").contains(c.get("status")),HttpStatus.CONFLICT,"Contest configuration is locked");
        var v=version(competition);
        Api.require(v.get("sealed_at")==null,HttpStatus.CONFLICT,"Clone the snapshot before editing");
        if(body.containsKey("title"))db.jdbc.update("UPDATE competitions SET title=? WHERE id=?",Api.text(body,"title",255),competition);
        for(var field:Map.of("description","description_md","rules","rules_md").entrySet())
            if(body.containsKey(field.getKey()))db.jdbc.update("UPDATE competition_versions SET "+field.getValue()+"=? WHERE id=?",String.valueOf(body.get(field.getKey())),v.get("id"));
        if(body.containsKey("durationSeconds"))db.jdbc.update("UPDATE competition_versions SET duration_seconds=? WHERE id=?",Api.number(body,"durationSeconds",3600,60,86400),v.get("id"));
        if(body.containsKey("scoringSystem"))db.jdbc.update("UPDATE competition_versions SET scoring_system=? WHERE id=?",scoring(body,"ICPC"),v.get("id"));
        if(body.containsKey("penalizeCompilationErrors"))db.jdbc.update("UPDATE competition_versions SET penalize_compilation_errors=? WHERE id=?",Boolean.TRUE.equals(body.get("penalizeCompilationErrors")),v.get("id"));
        if(body.containsKey("freezeBeforeEndSeconds"))db.jdbc.update("UPDATE competition_versions SET freeze_before_end_seconds=? WHERE id=?",Api.number(body,"freezeBeforeEndSeconds",0,0,86399),v.get("id"));
        if(body.containsKey("wrongAttemptPenaltySeconds"))db.jdbc.update("UPDATE competition_versions SET wrong_attempt_penalty_seconds=? WHERE id=?",Api.number(body,"wrongAttemptPenaltySeconds",1200,0,86400),v.get("id"));
        if(body.containsKey("languages")) {
            db.jdbc.update("DELETE FROM competition_version_languages WHERE competition_version_id=?",v.get("id"));
            for(String language:Api.languages(body))db.jdbc.update("INSERT INTO competition_version_languages VALUES (?,?)",v.get("id"),language);
        }
        for(var field:Map.of("registrationOpensAt","registration_opens_at","registrationClosesAt","registration_closes_at").entrySet())
            if(body.containsKey(field.getKey()))db.jdbc.update("UPDATE competition_versions SET "+field.getValue()+"=? WHERE id=?",Timestamp.from(Api.instant(body.get(field.getKey()))),v.get("id"));
        db.audit(actor.id(),"COMPETITION_EDIT","competition",competition,null);
    }
    @Transactional
    public void detach(Actor actor,UUID competition,int slot) {
        access.competition(actor,competition,false);db.one("SELECT id FROM competitions WHERE id=? FOR UPDATE",competition);
        var v=version(competition);Api.require(v.get("sealed_at")==null,HttpStatus.CONFLICT,"Clone the snapshot before editing");
        db.jdbc.update("DELETE FROM competition_problems WHERE competition_version_id=? AND slot=?",v.get("id"),slot);
    }
    public Map<String,Object> version(UUID competition) {
        return db.one("SELECT * FROM competition_versions WHERE competition_id=? ORDER BY version_number DESC LIMIT 1",competition);
    }
    @Transactional
    public UUID cloneVersion(Actor actor,UUID competition) {
        access.competition(actor,competition,false);
        var contest=db.one("SELECT * FROM competitions WHERE id=? FOR UPDATE",competition);
        Api.require(List.of("DRAFT","INTERNAL_TESTING","READY").contains(contest.get("status")),HttpStatus.CONFLICT,"Contest is already scheduled");
        var v=version(competition);Api.require(v.get("sealed_at")!=null,HttpStatus.CONFLICT,"Current snapshot is editable");
        UUID next=db.id("INSERT INTO competition_versions(competition_id,version_number,description_md,rules_md,mode,max_team_size,duration_seconds,scoring_system,wrong_attempt_penalty_seconds,penalize_compilation_errors,freeze_before_end_seconds,created_by) SELECT competition_id,version_number+1,description_md,rules_md,mode,max_team_size,duration_seconds,scoring_system,wrong_attempt_penalty_seconds,penalize_compilation_errors,freeze_before_end_seconds,? FROM competition_versions WHERE id=? RETURNING id",actor.id(),v.get("id"));
        db.jdbc.update("INSERT INTO competition_problems(competition_version_id,slot,label,problem_id,problem_version_id,points) SELECT ?,slot,label,problem_id,problem_version_id,points FROM competition_problems WHERE competition_version_id=?",next,v.get("id"));
        db.jdbc.update("INSERT INTO competition_version_languages SELECT ?,language_code FROM competition_version_languages WHERE competition_version_id=?",next,v.get("id"));
        if("READY".equals(contest.get("status")))db.jdbc.update("UPDATE competitions SET status='INTERNAL_TESTING' WHERE id=?",competition);
        return next;
    }
    @Transactional
    public void attach(Actor actor,UUID competition,UUID problemVersion,int slot,String label){attach(actor,competition,problemVersion,slot,label,null);}
    /** points: optional value for IOI, Codeforces and AtCoder scoring; null uses the system default. */
    @Transactional
    public void attach(Actor actor,UUID competition,UUID problemVersion,int slot,String label,Integer points) {
        access.competition(actor,competition,false);access.problemRead(actor,problemVersion);
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM problems p JOIN problem_versions v ON v.problem_id=p.id WHERE v.id=? AND p.system_benchmark)",problemVersion),HttpStatus.CONFLICT,"The benchmark problem cannot be used in a contest");
        db.one("SELECT id FROM competitions WHERE id=? FOR UPDATE",competition);
        var v=version(competition);Api.require(v.get("sealed_at")==null,HttpStatus.CONFLICT,"Clone the contest snapshot before editing");
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM problem_versions pv JOIN problems p ON p.id=pv.problem_id WHERE pv.id=? AND p.archived_at IS NOT NULL)",problemVersion),HttpStatus.CONFLICT,"This problem was deleted; restore it first");
        db.jdbc.update("INSERT INTO competition_problems(competition_version_id,slot,label,problem_id,problem_version_id,points) SELECT ?,?,?,problem_id,id,? FROM problem_versions WHERE id=?",
                v.get("id"),slot,label,points,problemVersion);
    }
    public List<String> readiness(Actor actor,UUID competition){access.competition(actor,competition,false);return readiness(competition);}
    public List<String> readiness(UUID competition) {
        var v=version(competition);List<String> errors=new ArrayList<>();
        var problems=db.jdbc.queryForList("SELECT p.* FROM competition_problems cp JOIN problem_versions p ON p.id=cp.problem_version_id WHERE cp.competition_version_id=?",v.get("id"));
        if(problems.isEmpty())errors.add("No problems assigned");
        for(var p:problems) {
            if(!List.of("APPROVED","PUBLISHED").contains(p.get("status")))errors.add("Problem is not approved: "+p.get("title"));
            if(!db.exists("SELECT EXISTS(SELECT 1 FROM problem_validation_results WHERE problem_version_id=? AND status='PASSED')",p.get("id")))errors.add("Missing passing validation: "+p.get("title"));
            if(!db.exists("SELECT EXISTS(SELECT 1 FROM competition_version_languages c JOIN problem_version_languages p ON p.language_code=c.language_code WHERE c.competition_version_id=? AND p.problem_version_id=?)",v.get("id"),p.get("id")))errors.add("No allowed language for "+p.get("title"));
        }
        for(var p:problems) {
            if(db.exists("SELECT EXISTS(SELECT 1 FROM problem_version_languages pl JOIN competition_version_languages cl ON cl.language_code=pl.language_code LEFT JOIN languages l ON l.code=pl.language_code WHERE pl.problem_version_id=? AND cl.competition_version_id=? AND NOT(l.enabled AND EXISTS(SELECT 1 FROM judge_workers w WHERE w.status='ONLINE' AND w.last_heartbeat_at>now()-interval '90 seconds' AND w.runtime_manifest->>'lane'='official' AND w.runtime_manifest->l.code->>'imageId'=(SELECT image_id FROM problem_runtime_pins pin WHERE pin.problem_version_id=pl.problem_version_id AND pin.language_code=l.code) AND w.runtime_manifest->l.code->>'verified'='true' AND (w.runtime_manifest->>'maxMemoryMb')::integer>=?)))",p.get("id"),v.get("id"),p.get("memory_limit_mb")))
                errors.add("No official worker with sufficient memory for "+p.get("title"));
        }
        return errors;
    }
    @Transactional
    public UUID rehearsal(Actor actor,UUID competition,Map<String,Object> body) {
        access.competition(actor,competition,false);
        var c=db.one("SELECT * FROM competitions WHERE id=? FOR UPDATE",competition);
        Api.require(List.of("DRAFT","INTERNAL_TESTING","READY").contains(c.get("status")),HttpStatus.CONFLICT,"Cannot rehearse a scheduled or finished contest");
        if("DRAFT".equals(c.get("status")))db.jdbc.update("UPDATE competitions SET status='INTERNAL_TESTING' WHERE id=?",competition);
        var v=version(competition);
        if(v.get("sealed_at")==null)db.jdbc.update("UPDATE competition_versions SET sealed_at=now() WHERE id=?",v.get("id"));
        UUID run=createRun(competition,v,"REHEARSAL",actor.id(),Instant.now());
        if("INDIVIDUAL".equals(v.get("mode"))) {
            Object users=body.getOrDefault("userIds",List.of(actor.id().toString()));
            Api.require(users instanceof List<?> && ((List<?>)users).size()<=100,HttpStatus.BAD_REQUEST,"Invalid rehearsal users");
            for(Object user:(List<?>)users)addIndividual(run,Api.uuid(user));
        } else {
            Object teams=body.get("teamIds");Api.require(teams instanceof List<?> && !((List<?>)teams).isEmpty(),HttpStatus.BAD_REQUEST,"Specify rehearsal teamIds");
            for(Object team:(List<?>)teams)addTeam(run,Api.uuid(team),((Number)v.get("max_team_size")).intValue());
        }
        db.audit(actor.id(),"REHEARSAL_START","run",run,null);return run;
    }
    private UUID createRun(UUID competition,Map<String,Object> v,String kind,UUID actor,Instant start) {
        return db.id("INSERT INTO contest_runs(competition_id,competition_version_id,kind,created_by,starts_at,ends_at,status) VALUES (?,?,?,?,?,?,?) RETURNING id",
                competition,v.get("id"),kind,actor,Timestamp.from(start),Timestamp.from(start.plusSeconds(((Number)v.get("duration_seconds")).longValue())),kind.equals("REHEARSAL")?"RUNNING":"PENDING");
    }
    @Transactional
    public UUID schedule(Actor actor,UUID competition,Instant start,String visibility) {
        access.competition(actor,competition,true);
        var c=db.one("SELECT * FROM competitions WHERE id=? FOR UPDATE",competition);
        Api.require(List.of("INTERNAL_TESTING","READY").contains(c.get("status")),HttpStatus.CONFLICT,"Run internal testing first");
        var errors=readiness(competition);Api.require(errors.isEmpty(),HttpStatus.CONFLICT,String.join("; ",errors));
        Api.require(start.isAfter(Instant.now()),HttpStatus.BAD_REQUEST,"Schedule a future start time");
        Api.require(List.of("PUBLIC","UNLISTED","PRIVATE").contains(visibility),HttpStatus.BAD_REQUEST,"Invalid visibility");
        var v=version(competition);
        if(v.get("sealed_at")==null)db.jdbc.update("UPDATE competition_versions SET sealed_at=now() WHERE id=?",v.get("id"));
        if("INTERNAL_TESTING".equals(c.get("status")))db.jdbc.update("UPDATE competitions SET status='READY' WHERE id=?",competition);
        db.jdbc.update("UPDATE competitions SET status='SCHEDULED',published_at=now(),visibility=? WHERE id=?",visibility,competition);
        UUID run=createRun(competition,v,"OFFICIAL",actor.id(),start);
        for(var reg:db.jdbc.queryForList("SELECT * FROM registrations WHERE competition_id=? AND status='APPROVED'",competition))
            if(reg.get("user_id")!=null)addIndividual(run,(UUID)reg.get("user_id"));else addTeam(run,(UUID)reg.get("team_id"),((Number)v.get("max_team_size")).intValue());
        db.audit(actor.id(),"COMPETITION_SCHEDULE","competition",competition,null);return run;
    }
    @Transactional
    public UUID register(Actor actor,UUID competition,UUID team) {
        var c=db.one("SELECT * FROM competitions WHERE id=? FOR UPDATE",competition);
        // Late registration is allowed while the contest runs (late entrants simply have less time).
        Api.require(c.get("published_at")!=null && List.of("SCHEDULED","RUNNING").contains(c.get("status")),HttpStatus.CONFLICT,"Registration is not open");
        Api.require(!"PRIVATE".equals(c.get("visibility")) || access.jury(actor,competition) || db.exists("SELECT EXISTS(SELECT 1 FROM competition_invitations WHERE competition_id=? AND user_id=?)",competition,actor.id()),HttpStatus.FORBIDDEN,"Private contest invitation required");
        var v=version(competition);
        if(v.get("registration_opens_at")!=null)Api.require(!Instant.now().isBefore(Api.time(v.get("registration_opens_at"))),HttpStatus.CONFLICT,"Registration is not open");
        if(v.get("registration_closes_at")!=null)Api.require(Instant.now().isBefore(Api.time(v.get("registration_closes_at"))),HttpStatus.CONFLICT,"Registration is closed");
        var run=db.one("SELECT * FROM contest_runs WHERE competition_id=? AND kind='OFFICIAL'",competition);
        Api.require(Instant.now().isBefore(Api.time(run.get("ends_at"))),HttpStatus.CONFLICT,"The contest has ended");
        if(team==null) {
            Api.require("INDIVIDUAL".equals(v.get("mode")),HttpStatus.BAD_REQUEST,"Register a team for this contest");
            UUID id=db.id("INSERT INTO registrations(competition_id,user_id,status) VALUES (?,?,'APPROVED') RETURNING id",competition,actor.id());
            addIndividual((UUID)run.get("id"),actor.id());return id;
        }
        Api.require("TEAM".equals(v.get("mode")),HttpStatus.BAD_REQUEST,"This is an individual contest");
        var t=db.one("SELECT * FROM teams WHERE id=? FOR UPDATE",team);
        Api.require(actor.id().equals(t.get("captain_id")),HttpStatus.FORBIDDEN,"Only the captain can register the team");
        UUID id=db.id("INSERT INTO registrations(competition_id,team_id,status) VALUES (?,?,'APPROVED') RETURNING id",competition,team);
        addTeam((UUID)run.get("id"),team,((Number)v.get("max_team_size")).intValue());return id;
    }
    /** Keeps a contest out of the rating or brings it back; the rating recalculates from saved results. */
    @Transactional
    public void setRated(Actor actor,UUID competition,boolean rated,String reason) {
        access.competition(actor,competition,false);
        db.jdbc.update("UPDATE competitions SET rated=? WHERE id=?",rated,competition);
        db.audit(actor.id(),rated?"COMPETITION_RATED":"COMPETITION_UNRATED","competition",competition,reason);
    }
    /** Lets a user register for a private competition. */
    @Transactional
    public void invite(Actor actor,UUID competition,UUID user) {
        access.competition(actor,competition,false);
        db.jdbc.update("INSERT INTO competition_invitations VALUES (?,?,?) ON CONFLICT DO NOTHING",competition,user,actor.id());
        db.audit(actor.id(),"PARTICIPANT_INVITE","competition",competition,null);
    }
    /** Grants or changes a user's staff access (MANAGER, JURY or TESTER); only the owner or a super administrator delegates. */
    @Transactional
    public void grantStaff(Actor actor,UUID competition,UUID user,String accessLevel,boolean canPublish,String reason) {
        var c=db.one("SELECT owner_id FROM competitions WHERE id=?",competition);
        Api.require(actor.superAdmin() || actor.id().equals(c.get("owner_id")),HttpStatus.FORBIDDEN,"Only the owner can delegate contest permissions");
        db.jdbc.update("INSERT INTO competition_staff(competition_id,user_id,access_level,can_publish,granted_by) VALUES (?,?,?,?,?) ON CONFLICT(competition_id,user_id) DO UPDATE SET access_level=excluded.access_level,can_publish=excluded.can_publish,granted_by=excluded.granted_by",
                competition,user,accessLevel,canPublish,actor.id());
        db.audit(actor.id(),"STAFF_GRANT","competition",competition,reason);
    }
    /**
     * Organizer registration of existing users by handle or email (individual contests).
     * Before scheduling, rows wait in registrations and join the official run at schedule
     * time; after scheduling they join immediately, until the contest ends.
     */
    @Transactional
    public List<Map<String,Object>> registerUsers(Actor actor,UUID competition,List<String> identifiers) {
        access.competition(actor,competition,false);
        var c=db.one("SELECT * FROM competitions WHERE id=? FOR UPDATE",competition);
        Api.require(!List.of("FINISHED","ARCHIVED").contains(c.get("status")),HttpStatus.CONFLICT,"The contest has ended");
        Api.require("INDIVIDUAL".equals(version(competition).get("mode")),HttpStatus.BAD_REQUEST,"Team contests are registered by team captains");
        var runs=db.jdbc.queryForList("SELECT * FROM contest_runs WHERE competition_id=? AND kind='OFFICIAL'",competition);
        if(!runs.isEmpty())Api.require(Instant.now().isBefore(Api.time(runs.get(0).get("ends_at"))),HttpStatus.CONFLICT,"The contest has ended");
        List<Map<String,Object>> results=new ArrayList<>();
        for(String raw:identifiers) {
            String key=raw.trim();if(key.isEmpty())continue;
            var row=new LinkedHashMap<String,Object>();row.put("user",key);results.add(row);
            var users=db.jdbc.queryForList("SELECT id,status FROM users WHERE lower(handle)=lower(?) OR email=lower(?)",key,key);
            if(users.isEmpty()){row.put("status","NOT_FOUND");continue;}
            if(!"ACTIVE".equals(users.get(0).get("status"))){row.put("status","INACTIVE");continue;}
            UUID user=(UUID)users.get(0).get("id");
            if(db.exists("SELECT EXISTS(SELECT 1 FROM registrations WHERE competition_id=? AND user_id=?)",competition,user)){row.put("status","ALREADY_REGISTERED");continue;}
            db.jdbc.update("INSERT INTO registrations(competition_id,user_id,status,decided_by) VALUES (?,?,'APPROVED',?)",competition,user,actor.id());
            db.jdbc.update("INSERT INTO competition_invitations VALUES (?,?,?) ON CONFLICT DO NOTHING",competition,user,actor.id());
            if(!runs.isEmpty())addIndividual((UUID)runs.get(0).get("id"),user);
            row.put("status","REGISTERED");
        }
        db.audit(actor.id(),"PARTICIPANTS_REGISTER","competition",competition,results.size()+" requested");
        return results;
    }
    private void addIndividual(UUID run,UUID user) {
        var u=db.one("SELECT display_name,status FROM users WHERE id=?",user);
        Api.require("ACTIVE".equals(u.get("status")),HttpStatus.CONFLICT,"Participant is inactive");
        UUID entry=db.id("INSERT INTO run_entries(run_id,display_name,user_id) VALUES (?,?,?) RETURNING id",run,u.get("display_name"),user);
        db.jdbc.update("INSERT INTO run_entry_members VALUES (?,?,?)",entry,run,user);
    }
    private void addTeam(UUID run,UUID team,int max) {
        var t=db.one("SELECT * FROM teams WHERE id=? FOR UPDATE",team);
        var members=db.jdbc.queryForList("SELECT m.user_id FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=? AND u.status='ACTIVE'",team);
        long all=db.jdbc.queryForObject("SELECT count(*) FROM team_members WHERE team_id=?",Long.class,team);
        Api.require(!members.isEmpty() && members.size()==all && members.size()<=max,HttpStatus.CONFLICT,"Invalid team size or inactive member");
        UUID entry=db.id("INSERT INTO run_entries(run_id,display_name,team_id) VALUES (?,?,?) RETURNING id",run,t.get("name"),team);
        for(var m:members)db.jdbc.update("INSERT INTO run_entry_members VALUES (?,?,?)",entry,run,m.get("user_id"));
    }
    public Map<String,Object> runAccess(Actor actor,UUID run,boolean releasedProblems) {
        var r=db.one("SELECT r.*,c.visibility,c.published_at FROM contest_runs r JOIN competitions c ON c.id=r.competition_id WHERE r.id=?",run);
        boolean jury=access.jury(actor,(UUID)r.get("competition_id"));
        boolean member=db.exists("SELECT EXISTS(SELECT 1 FROM run_entry_members WHERE run_id=? AND user_id=?)",run,actor.id());
        if("REHEARSAL".equals(r.get("kind")))Api.require(jury||member,HttpStatus.FORBIDDEN,"Private rehearsal");
        else Api.require(jury || member || (r.get("published_at")!=null && !"PRIVATE".equals(r.get("visibility"))),HttpStatus.FORBIDDEN,"Private contest");
        if(releasedProblems)Api.require(jury || !Instant.now().isBefore(Api.time(r.get("starts_at"))),HttpStatus.FORBIDDEN,"Problems are not released");
        return r;
    }
    @Transactional
    public void control(Actor actor,UUID run,Map<String,Object> body) {
        var r=db.one("SELECT * FROM contest_runs WHERE id=? FOR UPDATE",run);access.competition(actor,(UUID)r.get("competition_id"),false);
        String action=Api.text(body,"action",32),reason=Api.text(body,"reason",2000);
        // The run clock is immutable except for these audited organizer actions (see V11).
        if(List.of("start-now","end-now","extend","end-rehearsal").contains(action))db.jdbc.queryForList("SELECT set_config('cp.run_clock_change','on',true)");
        switch(action) {
            case "pause" -> db.jdbc.update("UPDATE contest_runs SET submissions_paused=true WHERE id=?",run);
            case "resume" -> db.jdbc.update("UPDATE contest_runs SET submissions_paused=false WHERE id=?",run);
            case "start-now" -> {
                // Starts a scheduled contest immediately; it still ends after its configured duration.
                Api.require("OFFICIAL".equals(r.get("kind")) && "PENDING".equals(r.get("status")),HttpStatus.CONFLICT,"Only a contest that has not started yet can be started now");
                db.jdbc.update("UPDATE contest_runs SET starts_at=now(),ends_at=now()+(ends_at-starts_at),status='RUNNING' WHERE id=?",run);
                db.jdbc.update("UPDATE competitions SET status='RUNNING' WHERE id=? AND status='SCHEDULED'",r.get("competition_id"));
            }
            case "end-now" -> {
                Api.require("RUNNING".equals(r.get("status")),HttpStatus.CONFLICT,"The contest is not running");
                db.jdbc.update("UPDATE contest_runs SET ends_at=now(),status='FINISHED' WHERE id=?",run);
                if("OFFICIAL".equals(r.get("kind")))db.jdbc.update("UPDATE competitions SET status='FINISHED' WHERE id=? AND status='RUNNING'",r.get("competition_id"));
            }
            case "extend" -> {
                int minutes=Api.number(body,"minutes",0,1,1440);
                Api.require(!"FINISHED".equals(r.get("status")),HttpStatus.CONFLICT,"The contest has finished");
                db.jdbc.update("UPDATE contest_runs SET ends_at=ends_at+make_interval(mins=>?) WHERE id=?",minutes,run);
            }
            case "end-rehearsal" -> {
                Api.require("REHEARSAL".equals(r.get("kind")),HttpStatus.CONFLICT,"Only rehearsals may be ended early");
                db.jdbc.update("UPDATE contest_runs SET ends_at=least(ends_at,greatest(now(),starts_at+interval '1 second')),status='FINISHED' WHERE id=?",run);
            }
            case "release-standings" -> {
                Api.require(!Instant.now().isBefore(Api.time(r.get("ends_at"))) || "FINISHED".equals(r.get("status")),HttpStatus.CONFLICT,"Contest has not ended");
                db.jdbc.update("UPDATE contest_runs SET final_standings_released_at=now() WHERE id=?",run);
            }
            default -> throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST,"Unknown action");
        }
        // Open arenas reload the run at once instead of showing the old clock until their next refresh.
        db.jdbc.update("INSERT INTO run_events(run_id,kind) VALUES (?,'RUN_UPDATED')",run);
        db.audit(actor.id(),"RUN_"+action.toUpperCase(Locale.ROOT),"run",run,reason);
    }
    @Transactional
    public void tick() {
        db.jdbc.update("UPDATE contest_runs SET status='RUNNING' WHERE status='PENDING' AND starts_at<=now() AND ends_at>now()");
        db.jdbc.update("UPDATE contest_runs SET status='FINISHED' WHERE status IN ('PENDING','RUNNING') AND ends_at<=now()");
        db.jdbc.update("UPDATE competitions c SET status='RUNNING' WHERE c.status='SCHEDULED' AND EXISTS(SELECT 1 FROM contest_runs r WHERE r.competition_id=c.id AND r.kind='OFFICIAL' AND r.starts_at<=now())");
        db.jdbc.update("UPDATE competitions c SET status='FINISHED' WHERE c.status='RUNNING' AND EXISTS(SELECT 1 FROM contest_runs r WHERE r.competition_id=c.id AND r.kind='OFFICIAL' AND r.ends_at<=now())");
    }
}
