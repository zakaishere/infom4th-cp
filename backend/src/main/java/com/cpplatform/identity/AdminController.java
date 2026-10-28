package com.cpplatform.identity;

import com.cpplatform.common.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
public class AdminController {
    private final Database db;private final Permissions access;private final AuthService accounts;
    public AdminController(Database db,Permissions access,AuthService accounts){this.db=db;this.access=access;this.accounts=accounts;}
    private Actor admin(Authentication authentication) {
        Actor actor=Actor.of(authentication);Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator permission required");return actor;
    }
    @GetMapping("/api/admin/users")
    Object users(Authentication auth,@RequestParam(defaultValue="0") int offset) {
        admin(auth);Api.require(offset>=0,HttpStatus.BAD_REQUEST,"Invalid offset");
        return db.jdbc.queryForList("SELECT id,email,handle,display_name,status FROM users ORDER BY created_at DESC LIMIT 100 OFFSET ?",offset);
    }
    /**
     * Bulk account creation, for example from a CSV of contestants. Each row is created
     * independently; generated passwords are returned once and never stored in clear.
     */
    @PostMapping("/api/admin/users/bulk")
    Object bulk(Authentication auth,@RequestBody Map<String,Object> body) {
        Actor actor=admin(auth);String reason=Api.text(body,"reason",2000);
        Api.require(body.get("users") instanceof List<?> l && !l.isEmpty() && l.size()<=300,HttpStatus.BAD_REQUEST,"Send 1-300 users");
        List<Map<String,Object>> results=new ArrayList<>();int created=0;
        for(Object item:(List<?>)body.get("users")) {
            var row=new LinkedHashMap<String,Object>();results.add(row);
            try {
                Api.require(item instanceof Map<?,?>,HttpStatus.BAD_REQUEST,"Invalid row");
                @SuppressWarnings("unchecked") Map<String,Object> u=(Map<String,Object>)item;
                String email=AuthService.email(u),handle=Api.text(u,"handle",32),name=Api.optional(u,"displayName",handle,100);
                String role=Api.optional(u,"role","PARTICIPANT",32);
                row.put("email",email);row.put("handle",handle);row.put("displayName",name);row.put("role",role);
                Api.require(Set.of("PARTICIPANT","MODERATOR","ADMIN").contains(role),HttpStatus.BAD_REQUEST,"Bulk roles: PARTICIPANT, MODERATOR or ADMIN");
                String password=u.get("password") instanceof String p && !p.isBlank()?p:"Cp-"+Tokens.random().replaceAll("[^A-Za-z0-9]","").substring(0,10)+"7!";
                row.put("userId",accounts.createAccount(email,handle,name,password,role));
                row.put("password",password);row.put("status","CREATED");created++;
            } catch(org.springframework.web.server.ResponseStatusException e) {
                row.put("status","ERROR");row.put("error",e.getReason());
            } catch(org.springframework.dao.DataIntegrityViolationException e) {
                row.put("status","ERROR");row.put("error","Email or handle already exists");
            }
        }
        db.audit(actor.id(),"USERS_BULK_CREATE","user",null,reason+" ("+created+" created)");
        return Map.of("created",created,"results",results);
    }
    @PutMapping("/api/admin/users/{id}/roles") @Transactional
    Object role(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Actor actor=admin(auth);String role=Api.text(body,"role",32),reason=Api.text(body,"reason",2000);
        // Additive grants avoid accidentally removing the final administrator.
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code,granted_by) VALUES (?,?,?) ON CONFLICT DO NOTHING",id,role,actor.id());
        db.audit(actor.id(),"ROLE_GRANT","user",id,reason);return Map.of("ok",true);
    }
    @PutMapping("/api/admin/languages/{language}") @Transactional
    Object language(Authentication auth,@PathVariable String language,@RequestBody Map<String,Object> body) {
        Actor actor=admin(auth);boolean enabled=Boolean.TRUE.equals(body.get("enabled"));String reason=Api.text(body,"reason",2000);
        if(enabled)Api.require(db.exists("SELECT EXISTS(SELECT 1 FROM judge_workers WHERE status='ONLINE' AND last_heartbeat_at>now()-interval '90 seconds' AND runtime_manifest->?->>'verified'='true' AND runtime_manifest->?->>'imageId'=?)",language,language,Api.text(body,"imageId",80)),
                HttpStatus.CONFLICT,"Verify this runtime on an online worker first");
        Api.require(db.jdbc.update("UPDATE languages SET enabled=?,runtime_image_id=?,admin_locked=true WHERE code=?",enabled,enabled?Api.text(body,"imageId",80):null,language)==1,HttpStatus.NOT_FOUND,"Unknown language");
        db.audit(actor.id(),"LANGUAGE_"+(enabled?"ENABLE":"DISABLE"),"language",null,language+": "+reason);return Map.of("ok",true);
    }
    @GetMapping("/api/admin/judge")
    Object judge(Authentication auth) {
        admin(auth);
        return Map.of("jobs",db.jdbc.queryForList("SELECT status,count(*) AS count,min(created_at) AS oldest FROM judging_jobs GROUP BY status"),
                "workers",db.jdbc.queryForList("SELECT id,name,status,capacity,last_heartbeat_at,runtime_manifest::text AS runtime_manifest FROM judge_workers"),
                "unpublishedEvents",db.jdbc.queryForObject("SELECT count(*) FROM judge_outbox WHERE published_at IS NULL",Long.class));
    }
    @PostMapping("/api/manage/submissions/{id}/rejudge") @Transactional @ResponseStatus(HttpStatus.ACCEPTED)
    Object rejudge(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);var s=db.one("SELECT * FROM submissions WHERE id=? FOR UPDATE",id);
        Api.require(!"LABORATORY".equals(s.get("context")),HttpStatus.CONFLICT,"Clone and revalidate laboratory versions");
        if(s.get("run_id")==null)Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator required for non-contest rejudging");
        else {var r=db.one("SELECT competition_id FROM contest_runs WHERE id=?",s.get("run_id"));access.competition(actor,(UUID)r.get("competition_id"),false);}
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM judging_jobs WHERE submission_id=? AND status IN ('QUEUED','RUNNING','RETRY'))",id),HttpStatus.CONFLICT,"Judging is already active");
        UUID job=db.id("INSERT INTO judging_jobs(submission_id,problem_version_id,generation,priority) SELECT ?,?,coalesce(max(generation),0)+1,100 FROM judging_jobs WHERE submission_id=? RETURNING id",id,s.get("problem_version_id"),id);
        db.audit(actor.id(),"SUBMISSION_REJUDGE","submission",id,Api.text(body,"reason",2000));return Map.of("jobId",job);
    }
    @PutMapping("/api/manage/competitions/{id}/invitations/{user}") @Transactional
    Object invite(Authentication auth,@PathVariable UUID id,@PathVariable UUID user) {
        Actor actor=Actor.of(auth);access.competition(actor,id,false);
        db.jdbc.update("INSERT INTO competition_invitations VALUES (?,?,?) ON CONFLICT DO NOTHING",id,user,actor.id());
        db.audit(actor.id(),"PARTICIPANT_INVITE","competition",id,null);return Map.of("ok",true);
    }
    @PutMapping("/api/manage/competitions/{id}/staff/{user}") @Transactional
    Object staff(Authentication auth,@PathVariable UUID id,@PathVariable UUID user,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);var c=db.one("SELECT owner_id FROM competitions WHERE id=?",id);
        Api.require(actor.superAdmin() || actor.id().equals(c.get("owner_id")),HttpStatus.FORBIDDEN,"Only the owner can delegate contest permissions");
        db.jdbc.update("INSERT INTO competition_staff(competition_id,user_id,access_level,can_publish,granted_by) VALUES (?,?,?,?,?) ON CONFLICT(competition_id,user_id) DO UPDATE SET access_level=excluded.access_level,can_publish=excluded.can_publish,granted_by=excluded.granted_by",
                id,user,Api.text(body,"accessLevel",16),Boolean.TRUE.equals(body.get("canPublish")),actor.id());
        db.audit(actor.id(),"STAFF_GRANT","competition",id,Api.text(body,"reason",2000));return Map.of("ok",true);
    }
    @PutMapping("/api/lab/problems/{version}/collaborators/{user}") @Transactional
    Object collaborator(Authentication auth,@PathVariable UUID version,@PathVariable UUID user,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);var p=db.one("SELECT p.id,p.owner_id FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=?",version);
        Api.require(actor.superAdmin() || actor.id().equals(p.get("owner_id")),HttpStatus.FORBIDDEN,"Only the owner can delegate problem permissions");
        db.jdbc.update("INSERT INTO problem_collaborators(problem_id,user_id,access_level,granted_by) VALUES (?,?,?,?) ON CONFLICT(problem_id,user_id) DO UPDATE SET access_level=excluded.access_level,granted_by=excluded.granted_by",
                p.get("id"),user,Api.text(body,"accessLevel",16),actor.id());
        return Map.of("ok",true);
    }
    @GetMapping("/api/admin/audit")
    Object audit(Authentication auth,@RequestParam(defaultValue="0") long after,@RequestParam(required=false) String type,
                 @RequestParam(defaultValue="false") boolean latest) {
        admin(auth);
        // Ascending cursor by default; latest=true returns the newest 200 entries, newest first.
        return db.jdbc.queryForList("SELECT a.id,a.actor_id,u.handle AS actor_handle,a.action,a.resource_type,a.resource_id,a.reason,a.metadata::text AS metadata,a.created_at FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.id>? AND (?::text IS NULL OR a.resource_type=?::text) ORDER BY "+(latest?"a.id DESC":"a.id")+" LIMIT 200",after,type,type);
    }
    @GetMapping("/api/admin/languages")
    Object languages(Authentication auth) {
        admin(auth);
        // verified_image_id: the image an online official worker verified for this language right now.
        return db.jdbc.queryForList("SELECT l.code,l.display_name,l.enabled,l.runtime_image_id,l.admin_locked,(SELECT w.runtime_manifest->l.code->>'imageId' FROM judge_workers w WHERE w.status='ONLINE' AND w.last_heartbeat_at>now()-interval '90 seconds' AND w.runtime_manifest->l.code->>'verified'='true' ORDER BY w.runtime_manifest->>'lane'='official' DESC LIMIT 1) AS verified_image_id FROM languages l ORDER BY l.code");
    }
}
