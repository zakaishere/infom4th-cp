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
        var users=db.jdbc.queryForList("SELECT id,password_hash,status FROM users WHERE email=?",email);
        String hash=users.isEmpty()?dummyHash:(String)users.get(0).get("password_hash");
        boolean valid=passwords.matches(password,hash);
        Api.require(valid && !users.isEmpty() && "ACTIVE".equals(users.get(0).get("status")),
                HttpStatus.UNAUTHORIZED,"Invalid credentials");
        UUID user=(UUID)users.get(0).get("id");
        return issue(user,UUID.randomUUID());
    }
    /** Signed-in password change: requires the current password, ends every other session
     *  and returns a fresh session for this browser. */
    @Transactional
    public Map<String,Object> changePassword(UUID user,Map<String,Object> body) {
        var row=db.one("SELECT password_hash FROM users WHERE id=? FOR UPDATE",user);
        Api.require(passwords.matches(Api.text(body,"currentPassword",200),(String)row.get("password_hash")),HttpStatus.BAD_REQUEST,"Current password is wrong");
        String next=password(Map.of("password",Api.text(body,"newPassword",200)));
        db.jdbc.update("UPDATE users SET password_hash=?,updated_at=now() WHERE id=?",passwords.encode(next),user);
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
    /** The signed-in account and the roles its access token carries. */
    public Map<String,Object> me(Actor actor) {
        var result=new LinkedHashMap<>(db.one("SELECT id,email,handle,display_name FROM users WHERE id=?",actor.id()));
        result.put("roles",actor.roles());return result;
    }
    @Transactional
    public void logout(Actor actor,String refresh) {
        db.jdbc.update("UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=? AND family_id IN (SELECT family_id FROM refresh_tokens WHERE token_digest=?)",
                actor.id(),Tokens.digest(refresh));
    }
    @Transactional
    public void forgot(String email) {
        var rows=db.jdbc.queryForList("SELECT id FROM users WHERE email=? AND status='ACTIVE'",email);
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
        db.jdbc.update("UPDATE users SET password_hash=?,updated_at=now() WHERE id=?",passwords.encode(password),user);
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
