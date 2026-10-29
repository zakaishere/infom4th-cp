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
    /** Staff roles from lowest to highest; every account also keeps PARTICIPANT. */
    static final List<String> STAFF=List.of("MODERATOR","ADMIN","SUPER_ADMIN");
    private static final String USER_FILTER=" WHERE (?::text IS NULL OR u.email ILIKE '%'||?::text||'%' OR u.handle ILIKE '%'||?::text||'%' OR u.display_name ILIKE '%'||?::text||'%')"+
            " AND (?::text IS NULL OR u.status=?::text)"+
            " AND (?::text IS NULL OR (?::text='PARTICIPANT' AND NOT EXISTS(SELECT 1 FROM user_roles x WHERE x.user_id=u.id AND x.role_code<>'PARTICIPANT'))"+
            " OR (?::text<>'PARTICIPANT' AND EXISTS(SELECT 1 FROM user_roles x WHERE x.user_id=u.id AND x.role_code=?::text)))";
    private static String blank(String value){return value==null||value.isBlank()?null:value.trim();}
    private static List<String> roles(Object joined){return joined==null||joined.toString().isEmpty()?List.of():List.of(joined.toString().split(","));}

    /** Filtered user list with roles; q matches email, handle or name, role PARTICIPANT means "no staff role". */
    @GetMapping("/api/admin/users")
    Object users(Authentication auth,@RequestParam(defaultValue="0") int offset,@RequestParam(required=false) String q,
                 @RequestParam(required=false) String role,@RequestParam(required=false) String status) {
        admin(auth);Api.require(offset>=0,HttpStatus.BAD_REQUEST,"Invalid offset");
        q=blank(q);role=blank(role);status=blank(status);
        Object[] args={q,q,q,q,status,status,role,role,role,role};
        var rows=db.jdbc.queryForList("SELECT u.id,u.email,u.handle,u.display_name,u.status,u.created_at,"+
                "(SELECT string_agg(r.role_code,',' ORDER BY r.role_code) FROM user_roles r WHERE r.user_id=u.id) AS roles,"+
                "(SELECT max(t.created_at) FROM refresh_tokens t WHERE t.user_id=u.id) AS last_seen_at,"+
                "(SELECT count(*) FROM submissions s WHERE s.submitted_by=u.id) AS submissions FROM users u"+USER_FILTER+
                " ORDER BY u.created_at DESC LIMIT 100 OFFSET ?",append(args,offset));
        rows.forEach(r->r.put("roles",roles(r.get("roles"))));
        var counts=db.jdbc.queryForMap("SELECT count(*) AS total FROM users u"+USER_FILTER,args);
        var byRole=db.jdbc.queryForList("SELECT role_code AS role,count(*) AS count FROM user_roles GROUP BY role_code");
        return Map.of("total",counts.get("total"),"users",rows,"roleCounts",byRole);
    }
    private static Object[] append(Object[] args,Object last){var all=Arrays.copyOf(args,args.length+1);all[args.length]=last;return all;}

    /** One user's profile, activity and every audit entry they made or that concerns them. */
    @GetMapping("/api/admin/users/{id}")
    Object user(Authentication auth,@PathVariable UUID id) {
        admin(auth);
        var user=new LinkedHashMap<>(db.one("SELECT id,email,handle,display_name,status,email_verified_at,created_at,updated_at FROM users WHERE id=?",id));
        user.put("roles",db.jdbc.queryForList("SELECT r.role_code AS role,r.granted_at,g.handle AS granted_by FROM user_roles r LEFT JOIN users g ON g.id=r.granted_by WHERE r.user_id=? ORDER BY r.granted_at",id));
        user.put("activity",db.jdbc.queryForMap("SELECT (SELECT count(*) FROM submissions WHERE submitted_by=?) AS submissions,"+
                "(SELECT count(*) FROM submissions s JOIN judging_jobs j ON j.submission_id=s.id JOIN judging_results r ON r.job_id=j.id WHERE s.submitted_by=? AND r.verdict='ACCEPTED') AS accepted,"+
                "(SELECT max(submitted_at) FROM submissions WHERE submitted_by=?) AS last_submission_at,"+
                "(SELECT count(*) FROM run_entry_members WHERE user_id=?) AS contest_entries,"+
                "(SELECT count(*) FROM team_members WHERE user_id=?) AS teams,"+
                "(SELECT count(*) FROM problems WHERE owner_id=?) AS problems_owned,"+
                "(SELECT count(*) FROM competitions WHERE owner_id=?) AS competitions_owned,"+
                "(SELECT max(created_at) FROM refresh_tokens WHERE user_id=?) AS last_seen_at,"+
                "(SELECT count(*) FROM refresh_tokens WHERE user_id=? AND revoked_at IS NULL AND expires_at>now()) AS active_sessions",id,id,id,id,id,id,id,id,id));
        user.put("audit",db.jdbc.queryForList("SELECT a.id,a.actor_id,u.handle AS actor_handle,a.action,a.resource_type,a.resource_id,a.reason,a.metadata::text AS metadata,a.created_at,"+
                "(a.actor_id=?) AS by_user FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id "+
                "WHERE a.actor_id=? OR (a.resource_type='user' AND a.resource_id=?) ORDER BY a.id DESC LIMIT 300",id,id,id));
        return user;
    }

    /**
     * Sets the user's staff role: exactly one of MODERATOR, ADMIN, SUPER_ADMIN, or PARTICIPANT for none.
     * Refuses changes that would leave the platform without a super administrator or demote yourself.
     */
    @PutMapping("/api/admin/users/{id}/role") @Transactional
    Object setRole(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Actor actor=admin(auth);String role=Api.text(body,"role",32),reason=Api.text(body,"reason",2000);
        Api.require(role.equals("PARTICIPANT") || STAFF.contains(role),HttpStatus.BAD_REQUEST,"Role must be PARTICIPANT, MODERATOR, ADMIN or SUPER_ADMIN");
        db.one("SELECT id FROM users WHERE id=? FOR UPDATE",id);
        db.jdbc.queryForList("SELECT user_id FROM user_roles WHERE role_code='SUPER_ADMIN' FOR UPDATE");
        var before=db.jdbc.queryForList("SELECT role_code FROM user_roles WHERE user_id=? ORDER BY role_code",String.class,id);
        if(before.contains("SUPER_ADMIN") && !role.equals("SUPER_ADMIN")) {
            Api.require(!actor.id().equals(id),HttpStatus.CONFLICT,"You cannot remove your own super administrator role; ask another super administrator");
            Api.require(db.jdbc.queryForObject("SELECT count(*) FROM user_roles r JOIN users u ON u.id=r.user_id WHERE r.role_code='SUPER_ADMIN' AND u.status='ACTIVE'",Long.class)>1,
                    HttpStatus.CONFLICT,"This is the last active super administrator");
        }
        db.jdbc.update("DELETE FROM user_roles WHERE user_id=? AND role_code IN ('MODERATOR','ADMIN','SUPER_ADMIN')",id);
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code,granted_by) VALUES (?,'PARTICIPANT',?) ON CONFLICT DO NOTHING",id,actor.id());
        if(!role.equals("PARTICIPANT"))db.jdbc.update("INSERT INTO user_roles(user_id,role_code,granted_by) VALUES (?,?,?)",id,role,actor.id());
        db.audit(actor.id(),"ROLE_SET","user",id,reason,"{\"previous\":\""+String.join(",",before)+"\",\"new\":\""+role+"\"}");
        return Map.of("ok",true);
    }

    /** Suspending a user also ends their sessions; their submissions and results are kept. */
    @PutMapping("/api/admin/users/{id}/status") @Transactional
    Object setStatus(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        Actor actor=admin(auth);String status=Api.text(body,"status",16),reason=Api.text(body,"reason",2000);
        Api.require(Set.of("ACTIVE","SUSPENDED").contains(status),HttpStatus.BAD_REQUEST,"Status must be ACTIVE or SUSPENDED");
        Api.require(!actor.id().equals(id),HttpStatus.CONFLICT,"You cannot change your own status");
        String before=(String)db.one("SELECT status FROM users WHERE id=? FOR UPDATE",id).get("status");
        if(!status.equals("ACTIVE") && db.exists("SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=? AND role_code='SUPER_ADMIN')",id))
            Api.require(db.jdbc.queryForObject("SELECT count(*) FROM user_roles r JOIN users u ON u.id=r.user_id WHERE r.role_code='SUPER_ADMIN' AND u.status='ACTIVE' AND u.id<>?",Long.class,id)>0,
                    HttpStatus.CONFLICT,"This is the last active super administrator");
        db.jdbc.update("UPDATE users SET status=?,updated_at=now() WHERE id=?",status,id);
        if(!status.equals("ACTIVE"))db.jdbc.update("UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=?",id);
        db.audit(actor.id(),"USER_"+(status.equals("ACTIVE")?"ACTIVATE":"SUSPEND"),"user",id,reason,"{\"previous\":\""+before+"\",\"new\":\""+status+"\"}");
        return Map.of("ok",true);
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
                 @RequestParam(defaultValue="false") boolean latest,@RequestParam(required=false) String actor) {
        admin(auth);actor=blank(actor);type=blank(type);
        // Ascending cursor by default; latest=true returns the newest 200 entries, newest first. actor matches a handle or email.
        return db.jdbc.queryForList("SELECT a.id,a.actor_id,u.handle AS actor_handle,a.action,a.resource_type,a.resource_id,a.reason,a.metadata::text AS metadata,a.created_at,"+
                "(SELECT t.handle FROM users t WHERE a.resource_type='user' AND t.id=a.resource_id) AS target_handle FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id "+
                "WHERE a.id>? AND (?::text IS NULL OR a.resource_type=?::text) AND (?::text IS NULL OR u.handle ILIKE '%'||?::text||'%' OR u.email ILIKE '%'||?::text||'%') ORDER BY "+(latest?"a.id DESC":"a.id")+" LIMIT 200",
                after,type,type,actor,actor,actor);
    }
    @GetMapping("/api/admin/languages")
    Object languages(Authentication auth) {
        admin(auth);
        // verified_image_id: the image an online official worker verified for this language right now.
        return db.jdbc.queryForList("SELECT l.code,l.display_name,l.enabled,l.runtime_image_id,l.admin_locked,(SELECT w.runtime_manifest->l.code->>'imageId' FROM judge_workers w WHERE w.status='ONLINE' AND w.last_heartbeat_at>now()-interval '90 seconds' AND w.runtime_manifest->l.code->>'verified'='true' ORDER BY w.runtime_manifest->>'lane'='official' DESC LIMIT 1) AS verified_image_id FROM languages l ORDER BY l.code");
    }
}
