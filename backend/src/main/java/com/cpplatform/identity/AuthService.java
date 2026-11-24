package com.cpplatform.identity;

import com.cpplatform.common.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import java.util.*;
import java.time.Instant;
import java.sql.Timestamp;

@Service
public class AuthService {
    private final Database db;
    private final ApplicationEventPublisher events;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder(12);
    private final String dummyHash = passwords.encode(Tokens.random());
    public AuthService(Database db, ApplicationEventPublisher events) { this.db=db; this.events=events; }
    public static String password(Map<String,Object> body) {
        String value=Api.text(body,"password",72);
        Api.require(value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=72
                && value.length()>=8 && value.matches("(?s).*[A-Z].*") && value.matches("(?s).*[0-9].*")
                && value.matches("(?s).*[^a-zA-Z0-9].*"), HttpStatus.BAD_REQUEST,
                "Password requires 8-72 bytes, uppercase, a number and a special character");
        return value;
    }
    public static String email(Map<String,Object> body) {
        String email=Api.text(body,"email",254).trim().toLowerCase(Locale.ROOT);
        Api.require(email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"),HttpStatus.BAD_REQUEST,"Invalid email");
        return email;
    }
    @Transactional
    public Map<String,Object> register(Map<String,Object> body) {
        String email=email(body), handle=Api.text(body,"handle",32);
        Api.require(handle.matches("[A-Za-z0-9_]{3,32}"),HttpStatus.BAD_REQUEST,"Invalid handle");
        UUID user=db.id("INSERT INTO users(email,handle,display_name,password_hash) VALUES (?,?,?,?) RETURNING id",
                email,handle,Api.text(body,"displayName",100),passwords.encode(password(body)));
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'PARTICIPANT')",user);
        db.audit(user,"REGISTER","user",user,null);
        return issue(user,UUID.randomUUID());
    }
    /** Administrator-created account (bulk import); no session is issued. */
    @Transactional
    public UUID createAccount(String email,String handle,String displayName,String password,String role) {
        Map<String,Object> body=Map.of("email",email,"handle",handle,"displayName",displayName,"password",password);
        Api.require(handle.matches("[A-Za-z0-9_]{3,32}"),HttpStatus.BAD_REQUEST,"Invalid handle");
        String normalized=email(body);
        Api.require(!db.exists("SELECT EXISTS(SELECT 1 FROM users WHERE email=? OR lower(handle)=lower(?))",normalized,handle),HttpStatus.CONFLICT,"Email or handle already exists");
        UUID user=db.id("INSERT INTO users(email,handle,display_name,password_hash) VALUES (?,?,?,?) RETURNING id",
                normalized,handle,Api.text(body,"displayName",100),passwords.encode(password(body)));
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'PARTICIPANT')",user);
        if(role!=null && !role.equals("PARTICIPANT"))db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,?)",user,role);
        return user;
    }
    @Transactional
    public Map<String,Object> login(Map<String,Object> body) {
        String email=email(body), password=Api.text(body,"password",200);
        // Strict isolation: only non-InfoM4th local accounts (idp_subject IS NULL) may use password login.
        var users=db.jdbc.queryForList("SELECT id,password_hash,status FROM users WHERE email=? AND idp_subject IS NULL",email);
        String stored=users.isEmpty()?null:(String)users.get(0).get("password_hash");
        String hash=(stored==null || stored.isBlank())?dummyHash:stored;
        boolean valid=passwords.matches(password,hash);
        Api.require(valid && stored!=null && !users.isEmpty() && "ACTIVE".equals(users.get(0).get("status")),
                HttpStatus.UNAUTHORIZED,"Invalid credentials");
        UUID user=(UUID)users.get(0).get("id");
        return issue(user,UUID.randomUUID());
    }

    /** Resolve an OIDC-verified InfoM4th identity strictly by `idp_subject = sub`.
     *  Delta-updates only InfoM4th-owned fields (email, display_name, email_verified_at)
     *  when they actually changed; CP-owned fields (handle, bio, school, roles) stay untouched. */
    @Transactional
    public UUID resolveOidcUser(String sub, String email, boolean emailVerified, String name, String preferredUsername) {
        Api.require(sub!=null && !sub.isBlank(), HttpStatus.UNAUTHORIZED, "Invalid identity");
        var rows=db.jdbc.queryForList("SELECT id,status,email,display_name,email_verified_at FROM users WHERE idp_subject=?",sub);
        UUID user; boolean created=false;
        String cleanEmail=(email!=null && email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) ? email.trim().toLowerCase(Locale.ROOT) : null;
        if(rows.isEmpty()) {
            String handle=uniqueHandle(preferredUsername!=null && !preferredUsername.isBlank() ? preferredUsername : sub);
            String mail=uniqueEmail(cleanEmail,handle);
            String display=firstNonBlank(name,preferredUsername,handle);
            Timestamp verified=emailVerified?Timestamp.from(Instant.now()):null;
            user=db.id("INSERT INTO users(email,handle,display_name,password_hash,idp_subject,email_verified_at) VALUES (?,?,?,?,?,?) RETURNING id",
                    mail,handle,display.substring(0,Math.min(100,display.length())),
                    null,sub,verified);
            db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'PARTICIPANT')",user);
            created=true;
        } else {
            var row=rows.get(0);
            user=(UUID)row.get("id");
            if(!"ACTIVE".equals(row.get("status")))
                throw new org.springframework.web.server.ResponseStatusException(HttpStatus.FORBIDDEN,"Account is not active");
            String nextDisplay=(name!=null && !name.isBlank()) ? name.substring(0,Math.min(100,name.length())) : (String)row.get("display_name");
            String currentEmail=(String)row.get("email");
            String nextEmail=currentEmail;
            if(cleanEmail!=null && emailVerified && !cleanEmail.equalsIgnoreCase(currentEmail)
                    && !db.exists("SELECT EXISTS(SELECT 1 FROM users WHERE email=? AND id<>?)",cleanEmail,user)) {
                nextEmail=cleanEmail;
            }
            boolean verifyNow=emailVerified && row.get("email_verified_at")==null;
            if(!Objects.equals(nextDisplay,row.get("display_name")) || !Objects.equals(nextEmail,currentEmail) || verifyNow) {
                db.jdbc.update("UPDATE users SET email=?,display_name=?,email_verified_at=coalesce(email_verified_at,?),updated_at=now() WHERE id=?",
                        nextEmail,nextDisplay,verifyNow?Timestamp.from(Instant.now()):null,user);
            }
        }
        db.audit(user,created?"OIDC_REGISTER":"OIDC_LOGIN","user",user,null);
        return user;
    }

    /** Sign in a verified InfoM4th identity into CP's existing opaque session model.
     *  The user stays in this database; the account is found/created by idp_subject,
     *  then AuthService.issue() produces the same session map as a password login. */
    @Transactional
    public Map<String,Object> loginDelegated(InfoM4thAuthService.Identity id) {
        Api.require(id!=null && id.sub()!=null && !id.sub().isBlank(), HttpStatus.UNAUTHORIZED,"Invalid identity");
        var rows=db.jdbc.queryForList("SELECT id,status FROM users WHERE idp_subject=?",id.sub());
        UUID user; boolean created=false;
        if(rows.isEmpty()) {
            String handle=uniqueHandle(id.sub());
            String mail=uniqueEmail(id.email(),handle);
            String display=firstNonBlank(id.name(),id.username(),handle);
            Timestamp verified=id.emailVerified()?Timestamp.from(Instant.now()):null;
            user=db.id("INSERT INTO users(email,handle,display_name,password_hash,idp_subject,email_verified_at) VALUES (?,?,?,?,?,?) RETURNING id",
                    mail,handle,display.substring(0,Math.min(100,display.length())),
                    passwords.encode(Tokens.random()),id.sub(),verified);
            db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'PARTICIPANT')",user);
            created=true;
        } else {
            user=(UUID)rows.get(0).get("id");
            if(!"ACTIVE".equals(rows.get(0).get("status")))
                throw new org.springframework.web.server.ResponseStatusException(HttpStatus.FORBIDDEN,"Account is not active");
        }
        db.audit(user,created?"DELEGATED_REGISTER":"DELEGATED_LOGIN","user",user,null);
        return issue(user,UUID.randomUUID());
    }

    /** Seed the first admin from an InfoM4th subject. When that identity later signs
     *  in, loginDelegated() finds this row by idp_subject and keeps the admin roles. */
    @Transactional
    public void bootstrapDelegatedAdmin(String sub) {
        if(sub==null || sub.isBlank()) return;
        sub=sub.trim();
        db.jdbc.queryForList("SELECT pg_advisory_xact_lock(81746291)");
        if(db.exists("SELECT EXISTS(SELECT 1 FROM user_roles WHERE role_code='SUPER_ADMIN')")) return;
        var rows=db.jdbc.queryForList("SELECT id FROM users WHERE idp_subject=?",sub);
        UUID user;
        if(rows.isEmpty()) {
            String handle=uniqueHandle(sub);
            String mail=uniqueEmail(null,handle);
            user=db.id("INSERT INTO users(email,handle,display_name,password_hash,idp_subject) VALUES (?,?,?,?,?) RETURNING id",
                    mail,handle,"Platform administrator",passwords.encode(Tokens.random()),sub);
        } else user=(UUID)rows.get(0).get("id");
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN') ON CONFLICT DO NOTHING",user);
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'PARTICIPANT') ON CONFLICT DO NOTHING",user);
        db.audit(user,"BOOTSTRAP_ADMIN_IDP","user",user,null);
    }

    private String uniqueHandle(String sub) {
        String digits=sub.replace("-","").replaceAll("[^A-Za-z0-9]","");
        if(digits.length()>20) digits=digits.substring(0,20);
        if(digits.length()<3) digits=UUID.randomUUID().toString().replace("-","").substring(0,12);
        String base="im4_"+digits; // 4 + <=20 = <=24 chars, matches [A-Za-z0-9_]{3,32}
        String handle=base;
        for(int i=2;i<1000;i++) {
            if(!db.exists("SELECT EXISTS(SELECT 1 FROM users WHERE lower(handle)=lower(?))",handle)) return handle;
            handle=(base+i).substring(0,Math.min(32,(base+i).length()));
        }
        return base;
    }

    private String uniqueEmail(String preferred,String handle) {
        String base=(preferred==null || preferred.length()>200 || !preferred.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))
                ? handle+"@idp.invalid" : preferred.toLowerCase(Locale.ROOT);
        String candidate=base; int at=base.indexOf('@');
        for(int i=2;i<1000;i++) {
            if(!db.exists("SELECT EXISTS(SELECT 1 FROM users WHERE email=?)",candidate)) return candidate;
            candidate=base.substring(0,at)+"+idp"+i+base.substring(at);
        }
        return "idp-"+Tokens.random().substring(0,12)+"@idp.invalid";
    }

    private static String firstNonBlank(String... values) {
        for(String v:values) if(v!=null && !v.isBlank()) return v;
        return "Member";
    }

    /** Signed-in password change: requires the current password, ends every other session
     *  and returns a fresh session for this browser. */
    @Transactional
    public Map<String,Object> changePassword(UUID user,Map<String,Object> body) {
        var row=db.one("SELECT password_hash,idp_subject FROM users WHERE id=? FOR UPDATE",user);
        Api.require(row.get("idp_subject")==null,HttpStatus.BAD_REQUEST,"InfoM4th accounts manage their password on the InfoM4th website");
        String stored=(String)row.get("password_hash");
        Api.require(stored!=null && passwords.matches(Api.text(body,"currentPassword",200),stored),HttpStatus.BAD_REQUEST,"Current password is wrong");
        String next=password(Map.of("password",Api.text(body,"newPassword",200)));
        db.jdbc.update("UPDATE users SET password_hash=?,updated_at=now() WHERE id=?",passwords.encode(next),user);
        db.jdbc.update("UPDATE password_reset_tokens SET used_at=now() WHERE user_id=? AND used_at IS NULL",user);
        db.jdbc.update("UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=?",user);
        db.audit(user,"PASSWORD_CHANGE","user",user,null);
        return issue(user,UUID.randomUUID());
    }
    private Map<String,Object> issue(UUID user, UUID family) {
        String access=Tokens.random(), refresh=Tokens.random();
        UUID id=db.id("INSERT INTO refresh_tokens(user_id,token_digest,family_id,expires_at) VALUES (?,?,?,now()+interval '30 days') RETURNING id",
                user,Tokens.digest(refresh),family);
        db.jdbc.update("INSERT INTO access_tokens VALUES (?,?,now()+interval '15 minutes')",Tokens.digest(access),id);
        return Map.of("accessToken",access,"refreshToken",refresh,"expiresIn",900,"userId",user);
    }
    @Transactional
    public Optional<Map<String,Object>> refresh(String token) {
        var rows=db.jdbc.queryForList("SELECT rt.*,u.status FROM refresh_tokens rt JOIN users u ON u.id=rt.user_id WHERE token_digest=? FOR UPDATE OF rt",
                Tokens.digest(token));
        if(rows.isEmpty()) return Optional.empty();
        var row=rows.get(0);
        if(row.get("revoked_at")!=null) {
            db.jdbc.update("UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE family_id=?",row.get("family_id"));
            return Optional.empty(); // commit revocation before controller rejects replay
        }
        if(!"ACTIVE".equals(row.get("status")) || !Api.time(row.get("expires_at")).isAfter(Instant.now())) return Optional.empty();
        db.jdbc.update("UPDATE refresh_tokens SET revoked_at=now() WHERE id=?",row.get("id"));
        return Optional.of(issue((UUID)row.get("user_id"),(UUID)row.get("family_id")));
    }
    /** The signed-in account and the roles its session carries. */
    public Map<String,Object> me(Actor actor) {
        var row=db.one("SELECT id,email,handle,display_name,(idp_subject IS NOT NULL) AS is_idp FROM users WHERE id=?",actor.id());
        var result=new LinkedHashMap<>(row);
        result.put("roles",actor.roles());return result;
    }
    @Transactional
    public void logout(Actor actor,String refresh) {
        if(refresh==null || refresh.isBlank()) return;
        db.jdbc.update("UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=? AND family_id IN (SELECT family_id FROM refresh_tokens WHERE token_digest=?)",
                actor.id(),Tokens.digest(refresh));
    }
    @Transactional
    public void forgot(String email) {
        // Strict isolation: InfoM4th SSO accounts reset passwords on InfoM4th, never locally.
        var rows=db.jdbc.queryForList("SELECT id FROM users WHERE email=? AND status='ACTIVE' AND idp_subject IS NULL",email);
        if(rows.isEmpty()) return;
        UUID user=(UUID)rows.get(0).get("id"); String token=Tokens.random();
        db.jdbc.update("UPDATE password_reset_tokens SET used_at=now() WHERE user_id=? AND used_at IS NULL",user);
        db.jdbc.update("INSERT INTO password_reset_tokens VALUES (?,?,now()+interval '30 minutes',NULL)",Tokens.digest(token),user);
        events.publishEvent(new ResetMail.Request(email,token));
    }
    @Transactional
    public void reset(String token,String password) {
        var rows=db.jdbc.queryForList("UPDATE password_reset_tokens SET used_at=now() WHERE token_digest=? AND used_at IS NULL AND expires_at>now() RETURNING user_id",Tokens.digest(token));
        Api.require(!rows.isEmpty(),HttpStatus.BAD_REQUEST,"Invalid or expired reset token");
        UUID user=(UUID)rows.get(0).get("user_id");
        int updated=db.jdbc.update("UPDATE users SET password_hash=?,updated_at=now() WHERE id=? AND idp_subject IS NULL",passwords.encode(password),user);
        Api.require(updated>0,HttpStatus.BAD_REQUEST,"InfoM4th accounts reset their password on the InfoM4th website");
        db.jdbc.update("UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=?",user);
        db.audit(user,"PASSWORD_RESET","user",user,null);
    }
    @Transactional
    public void bootstrap(String email,String password) {
        db.jdbc.queryForList("SELECT pg_advisory_xact_lock(81746290)");
        if(db.exists("SELECT EXISTS(SELECT 1 FROM user_roles WHERE role_code='SUPER_ADMIN')")) return;
        email=email(Map.of("email",email)); password=password(Map.of("password",password));
        UUID user=db.id("INSERT INTO users(email,handle,display_name,password_hash,email_verified_at) VALUES (?,'platform_admin','Platform administrator',?,now()) RETURNING id",
                email,passwords.encode(password));
        db.jdbc.update("INSERT INTO user_roles(user_id,role_code) VALUES (?,'SUPER_ADMIN'),(?,'PARTICIPANT')",user,user);
        db.audit(user,"BOOTSTRAP_ADMIN","user",user,null);
    }
}
