package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
public class CommunicationsController {
    private final Database db;private final CompetitionService contests;private final Permissions access;private final RateLimits limits;
    public CommunicationsController(Database db,CompetitionService contests,Permissions access,RateLimits limits){this.db=db;this.contests=contests;this.access=access;this.limits=limits;}
    @GetMapping("/api/runs/{run}/announcements")
    Object announcements(Authentication auth,@PathVariable UUID run) {
        contests.runAccess(Actor.of(auth),run,false);
        return db.jdbc.queryForList("SELECT id,title,body_md,published_at FROM announcements WHERE run_id=? AND published_at<=now() ORDER BY published_at",run);
    }
    @PostMapping("/api/manage/runs/{run}/announcements") @Transactional @ResponseStatus(HttpStatus.CREATED)
    Object announce(Authentication auth,@PathVariable UUID run,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);var r=db.one("SELECT competition_id FROM contest_runs WHERE id=?",run);
        access.competition(actor,(UUID)r.get("competition_id"),false);
        UUID id=db.id("INSERT INTO announcements(run_id,author_id,title,body_md,published_at) VALUES (?,?,?,?,now()) RETURNING id",
                run,actor.id(),Api.text(body,"title",255),Api.text(body,"body",16000));
        db.jdbc.update("INSERT INTO run_events(run_id,kind) VALUES (?,'ANNOUNCEMENT')",run);
        db.audit(actor.id(),"ANNOUNCEMENT_PUBLISH","run",run,null);return Map.of("announcementId",id);
    }
    @PostMapping("/api/runs/{run}/clarifications") @Transactional @ResponseStatus(HttpStatus.CREATED)
    Object ask(Authentication auth,@PathVariable UUID run,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);contests.runAccess(actor,run,true);limits.check("clarification:"+actor.id(),10,600);
        var member=db.one("SELECT entry_id FROM run_entry_members WHERE run_id=? AND user_id=?",run,actor.id());
        return Map.of("clarificationId",db.id("INSERT INTO clarifications(run_id,entry_id,asked_by,question) VALUES (?,?,?,?) RETURNING id",
                run,member.get("entry_id"),actor.id(),Api.text(body,"question",8000)));
    }
    @GetMapping("/api/runs/{run}/clarifications")
    Object questions(Authentication auth,@PathVariable UUID run) {
        Actor actor=Actor.of(auth);var r=contests.runAccess(actor,run,false);
        return db.jdbc.queryForList("SELECT c.id,c.entry_id,c.question,c.answer,c.is_public,c.created_at,c.answered_at FROM clarifications c WHERE c.run_id=? AND (c.is_public OR ? OR EXISTS(SELECT 1 FROM run_entry_members m WHERE m.entry_id=c.entry_id AND m.user_id=?)) ORDER BY c.created_at DESC LIMIT 200",
                run,access.jury(actor,(UUID)r.get("competition_id")),actor.id());
    }
    @PostMapping("/api/manage/clarifications/{id}/answer") @Transactional
    Object answer(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);var c=db.one("SELECT c.run_id,r.competition_id FROM clarifications c JOIN contest_runs r ON r.id=c.run_id WHERE c.id=?",id);
        Api.require(access.jury(actor,(UUID)c.get("competition_id")),HttpStatus.FORBIDDEN,"Jury permission required");
        db.jdbc.update("UPDATE clarifications SET answer=?,answered_by=?,answered_at=now(),is_public=? WHERE id=?",
                Api.text(body,"answer",16000),actor.id(),Boolean.TRUE.equals(body.get("public")),id);
        db.jdbc.update("INSERT INTO run_events(run_id,kind) VALUES (?,'CLARIFICATION_UPDATED')",c.get("run_id"));
        db.audit(actor.id(),"CLARIFICATION_ANSWER","clarification",id,null);return Map.of("ok",true);
    }
}
