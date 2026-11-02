package com.cpplatform.identity;

import com.cpplatform.common.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import java.util.*;

/** SUPER_ADMIN account management: finding users, their roles and status, bulk creation and the audit log. */
@Service
public class UserAdminService {
    /** Staff roles from lowest to highest; every account also keeps PARTICIPANT. */
    static final List<String> STAFF=List.of("MODERATOR","ADMIN","SUPER_ADMIN");
    private static final String USER_FILTER=" WHERE (?::text IS NULL OR u.email ILIKE '%'||?::text||'%' OR u.handle ILIKE '%'||?::text||'%' OR u.display_name ILIKE '%'||?::text||'%')"+
            " AND (?::text IS NULL OR u.status=?::text)"+
            " AND (?::text IS NULL OR (?::text='PARTICIPANT' AND NOT EXISTS(SELECT 1 FROM user_roles x WHERE x.user_id=u.id AND x.role_code<>'PARTICIPANT'))"+
            " OR (?::text<>'PARTICIPANT' AND EXISTS(SELECT 1 FROM user_roles x WHERE x.user_id=u.id AND x.role_code=?::text)))";
    private final Database db;private final AuthService accounts;
    public UserAdminService(Database db,AuthService accounts){this.db=db;this.accounts=accounts;}
    static Actor requireSuperAdmin(Actor actor) {
        Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator permission required");return actor;
    }
    private static String blank(String value){return value==null||value.isBlank()?null:value.trim();}
    private static List<String> roles(Object joined){return joined==null||joined.toString().isEmpty()?List.of():List.of(joined.toString().split(","));}
    private static Object[] append(Object[] args,Object last){var all=Arrays.copyOf(args,args.length+1);all[args.length]=last;return all;}

    /** Filtered user list with roles; q matches email, handle or name, role PARTICIPANT means "no staff role". */
    public Map<String,Object> users(Actor actor,int offset,String q,String role,String status) {
        requireSuperAdmin(actor);Api.require(offset>=0,HttpStatus.BAD_REQUEST,"Invalid offset");
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
    /** One user's profile, activity and every audit entry they made or that concerns them. */
    public Map<String,Object> user(Actor actor,UUID id) {
        requireSuperAdmin(actor);
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
    @Transactional
    public void setRole(Actor actor,UUID id,String role,String reason) {
        requireSuperAdmin(actor);
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
    }
    /** Suspending a user also ends their sessions; their submissions and results are kept. */
    @Transactional
    public void setStatus(Actor actor,UUID id,String status,String reason) {
        requireSuperAdmin(actor);
        Api.require(Set.of("ACTIVE","SUSPENDED").contains(status),HttpStatus.BAD_REQUEST,"Status must be ACTIVE or SUSPENDED");
        Api.require(!actor.id().equals(id),HttpStatus.CONFLICT,"You cannot change your own status");
        String before=(String)db.one("SELECT status FROM users WHERE id=? FOR UPDATE",id).get("status");
        if(!status.equals("ACTIVE") && db.exists("SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=? AND role_code='SUPER_ADMIN')",id))
            Api.require(db.jdbc.queryForObject("SELECT count(*) FROM user_roles r JOIN users u ON u.id=r.user_id WHERE r.role_code='SUPER_ADMIN' AND u.status='ACTIVE' AND u.id<>?",Long.class,id)>0,
                    HttpStatus.CONFLICT,"This is the last active super administrator");
        db.jdbc.update("UPDATE users SET status=?,updated_at=now() WHERE id=?",status,id);
        if(!status.equals("ACTIVE"))db.jdbc.update("UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=?",id);
        db.audit(actor.id(),"USER_"+(status.equals("ACTIVE")?"ACTIVATE":"SUSPEND"),"user",id,reason,"{\"previous\":\""+before+"\",\"new\":\""+status+"\"}");
    }
    /**
     * Bulk account creation, for example from a CSV of contestants. Each row is created
     * independently; generated passwords are returned once and never stored in clear.
     */
    public Map<String,Object> bulk(Actor actor,List<?> users,String reason) {
        requireSuperAdmin(actor);
        List<Map<String,Object>> results=new ArrayList<>();int created=0;
        for(Object item:users) {
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
    /** Ascending cursor by default; latest=true returns the newest 200 entries, newest first. actor matches a handle or email. */
    public List<Map<String,Object>> audit(Actor viewer,long after,String type,boolean latest,String actor) {
        requireSuperAdmin(viewer);actor=blank(actor);type=blank(type);
        return db.jdbc.queryForList("SELECT a.id,a.actor_id,u.handle AS actor_handle,a.action,a.resource_type,a.resource_id,a.reason,a.metadata::text AS metadata,a.created_at,"+
                "(SELECT t.handle FROM users t WHERE a.resource_type='user' AND t.id=a.resource_id) AS target_handle FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id "+
                "WHERE a.id>? AND (?::text IS NULL OR a.resource_type=?::text) AND (?::text IS NULL OR u.handle ILIKE '%'||?::text||'%' OR u.email ILIKE '%'||?::text||'%') ORDER BY "+(latest?"a.id DESC":"a.id")+" LIMIT 200",
                after,type,type,actor,actor,actor);
    }
}
