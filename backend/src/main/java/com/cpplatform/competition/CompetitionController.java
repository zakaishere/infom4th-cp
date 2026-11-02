package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
public class CompetitionController {
    private final CompetitionService contests;private final CompetitionQueries views;private final SubmissionService submissions;
    private final StandingsService standings;private final PracticeService practice;
    private final String timeZone;
    public CompetitionController(CompetitionService contests,CompetitionQueries views,SubmissionService submissions,StandingsService standings,PracticeService practice,
                                 @org.springframework.beans.factory.annotation.Value("${cp.display-timezone:UTC}") String timeZone) {
        this.timeZone=java.time.ZoneId.of(timeZone).getId();
        this.practice=practice;
        this.contests=contests;this.views=views;this.submissions=submissions;this.standings=standings;
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
    Object managedDetail(Authentication auth,@PathVariable UUID id){return views.managed(Actor.of(auth),id);}
    @GetMapping("/api/manage/competitions")
    Object manage(Authentication auth){return views.managed(Actor.of(auth));}
    @PostMapping("/api/manage/competitions/{id}/clone-version")
    Object cloneVersion(Authentication auth,@PathVariable UUID id){return Map.of("versionId",contests.cloneVersion(Actor.of(auth),id));}
    @PostMapping("/api/manage/competitions/{id}/problems")
    Object attach(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Integer points=body.get("points")==null?null:Api.number(body,"points",100,1,100000);
        contests.attach(Actor.of(auth),id,Api.uuid(body.get("versionId")),Api.number(body,"slot",1,1,100),Api.text(body,"label",8),points);return Map.of("ok",true);
    }
    @GetMapping("/api/manage/competitions/{id}/readiness")
    Object readiness(Authentication auth,@PathVariable UUID id) {
        var errors=contests.readiness(Actor.of(auth),id);return Map.of("ready",errors.isEmpty(),"errors",errors);
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
    Object languages(){return views.languages();}
    @PostMapping("/api/manage/competitions/{id}/participants")
    Object participants(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Api.require(body.get("users") instanceof List<?> l && !l.isEmpty() && l.size()<=1000,HttpStatus.BAD_REQUEST,"Send 1-1000 handles or emails");
        return contests.registerUsers(Actor.of(auth),id,((List<?>)body.get("users")).stream().map(String::valueOf).toList());
    }
    @GetMapping("/api/manage/competitions/{id}/participants")
    Object listParticipants(Authentication auth,@PathVariable UUID id){return views.participants(Actor.of(auth),id);}
    @PutMapping("/api/manage/competitions/{id}/invitations/{user}")
    Object invite(Authentication auth,@PathVariable UUID id,@PathVariable UUID user){contests.invite(Actor.of(auth),id,user);return Map.of("ok",true);}
    @PutMapping("/api/manage/competitions/{id}/staff/{user}")
    Object staff(Authentication auth,@PathVariable UUID id,@PathVariable UUID user,@RequestBody Map<String,Object> body) {
        contests.grantStaff(Actor.of(auth),id,user,Api.text(body,"accessLevel",16),Boolean.TRUE.equals(body.get("canPublish")),Api.text(body,"reason",2000));return Map.of("ok",true);
    }
    @GetMapping("/api/competitions")
    Object list(){return views.published();}
    /** Runs the caller is an entrant of, including rehearsals and unlisted/private contests. */
    @GetMapping("/api/me/runs")
    Object myRuns(Authentication auth){return views.runsOf(Actor.of(auth));}
    @PostMapping("/api/competitions/{id}/register") @ResponseStatus(HttpStatus.CREATED)
    Object register(Authentication auth,@PathVariable UUID id,@RequestBody(required=false) Map<String,Object> body) {
        UUID team=body!=null && body.get("teamId")!=null?Api.uuid(body.get("teamId")):null;
        return Map.of("registrationId",contests.register(Actor.of(auth),id,team));
    }
    @GetMapping("/api/runs/{run}")
    Object run(Authentication auth,@PathVariable UUID run){return views.run(Actor.of(auth),run);}
    @GetMapping("/api/runs/{run}/problems/{slot}")
    Object problem(Authentication auth,@PathVariable UUID run,@PathVariable int slot){return views.runProblem(Actor.of(auth),run,slot);}
    @PostMapping("/api/runs/{run}/problems/{slot}/submissions") @ResponseStatus(HttpStatus.ACCEPTED)
    Object submit(Authentication auth,@PathVariable UUID run,@PathVariable int slot,@RequestHeader("Idempotency-Key") UUID key,@RequestBody Map<String,Object> body) {
        return Map.of("submissionId",submissions.submit(Actor.of(auth),run,slot,null,key,body),"status","QUEUED");
    }
    @GetMapping("/api/runs/{run}/standings")
    Object standings(Authentication auth,@PathVariable UUID run,@RequestParam(defaultValue="false") boolean jury){return standings.get(Actor.of(auth),run,jury);}
    @GetMapping("/api/runs/{run}/events")
    Object events(Authentication auth,@PathVariable UUID run,@RequestParam(defaultValue="0") long after){return views.events(Actor.of(auth),run,after);}
    @PostMapping("/api/manage/runs/{run}/control")
    Object control(Authentication auth,@PathVariable UUID run,@RequestBody Map<String,Object> body){contests.control(Actor.of(auth),run,body);return Map.of("ok",true);}
    /** Practice catalog with community statistics and the caller's own status per problem. */
    @GetMapping("/api/practice")
    Object practiceCatalog(Authentication auth){return Map.of("problems",practice.catalog(Actor.of(auth)),"tags",practice.allTags());}
    @GetMapping("/api/practice/{version}")
    Object practiceProblem(Authentication auth,@PathVariable UUID version) {
        var stats=practice.stats(Actor.of(auth),version);
        var result=new LinkedHashMap<String,Object>(views.problem(version));
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
    Object result(Authentication auth,@PathVariable UUID id){return submissions.result(Actor.of(auth),id);}
    @GetMapping("/api/submissions")
    Object history(Authentication auth,@RequestParam(required=false) UUID run,@RequestParam(defaultValue="0") int offset){return submissions.history(Actor.of(auth),run,offset);}
    /** Jury submission monitor for one run; source is fetched separately through /api/submissions/{id}. */
    @GetMapping("/api/manage/runs/{run}/submissions")
    Object jurySubmissions(Authentication auth,@PathVariable UUID run,@RequestParam(defaultValue="0") int offset){return submissions.forJury(Actor.of(auth),run,offset);}
    @PostMapping("/api/manage/submissions/{id}/rejudge") @ResponseStatus(HttpStatus.ACCEPTED)
    Object rejudge(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        return Map.of("jobId",submissions.rejudge(Actor.of(auth),id,Api.text(body,"reason",2000)));
    }
}
