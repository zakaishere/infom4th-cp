package com.cpplatform.identity;

import com.cpplatform.common.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
public class AuthController {
    private final AuthService auth; private final RateLimits limits; private final InfoM4thAuthService idp; private final OidcSupport oidc;
    public AuthController(AuthService auth,RateLimits limits,InfoM4thAuthService idp,OidcSupport oidc) {
        this.auth=auth;this.limits=limits;this.idp=idp;this.oidc=oidc;
    }
    /** Public capability flag so the login screen can adapt without a rebuild. */
    @GetMapping("/api/auth/config")
    Object authConfig() {
        boolean enabled = oidc.enabled() || idp.enabled();
        return Map.of("delegatedAuth", enabled, "oidc", oidc.enabled(), "provider", "InfoM4th");
    }
    /** Public registration is closed when InfoM4th is the identity provider.
     *  Older CP accounts keep working, and admins create non InfoM4th accounts
     *  through /api/admin/users/bulk. */
    @PostMapping("/api/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    Object register(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        Api.require(!(oidc.enabled() || idp.enabled()),HttpStatus.FORBIDDEN,"Public registration is disabled. Create an InfoM4th account on the website, or ask an admin to create a non InfoM4th account.");
        limits.check("register:"+request.getRemoteAddr(),250,3600);
        Map<String,Object> issued = auth.register(body);
        establishSession(request, (UUID) issued.get("userId"));
        return issued;
    }
    @PostMapping("/api/auth/login")
    Object login(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        limits.check("login-ip:"+request.getRemoteAddr(),120,60);
        limits.check("login-user:"+AuthService.email(body),10,60);
        Map<String,Object> issued = auth.login(body);
        establishSession(request, (UUID) issued.get("userId"));
        return issued;
    }
    /** Legacy delegated sign-in (retained for backward compatibility with existing tests while ROPC is deprecated). */
    @PostMapping("/api/auth/infom4th")
    Object loginInfom4th(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        limits.check("login-ip:"+request.getRemoteAddr(),120,60);
        String email=AuthService.email(body);
        limits.check("login-user:"+email,10,60);
        InfoM4thAuthService.Identity identity=idp.exchangeAndVerify(email,Api.text(body,"password",200));
        Map<String,Object> issued = auth.loginDelegated(identity);
        establishSession(request, (UUID) issued.get("userId"));
        return issued;
    }
    @PostMapping("/api/auth/refresh")
    Object refresh(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        limits.check("refresh:"+request.getRemoteAddr(),120,60);
        return auth.refresh(Api.text(body,"refreshToken",100)).orElseThrow(()->new org.springframework.web.server.ResponseStatusException(HttpStatus.UNAUTHORIZED,"Invalid refresh token"));
    }
    @PostMapping("/api/auth/logout")
    Object logout(@RequestBody(required = false) Map<String,Object> body,Authentication authentication,HttpServletRequest request) {
        if (body != null && body.get("refreshToken") instanceof String rt && !rt.isBlank()) {
            auth.logout(Actor.of(authentication), rt);
        }
        String endSessionUrl = null;
        HttpSession session = request.getSession(false);
        if (session != null) {
            Object idToken = session.getAttribute(OidcSupport.SESSION_ID_TOKEN);
            if (idToken instanceof String token && !token.isBlank()) {
                String origin = request.getScheme() + "://" + request.getServerName()
                        + ((request.getServerPort() == 80 || request.getServerPort() == 443) ? "" : ":" + request.getServerPort()) + "/";
                endSessionUrl = oidc.buildEndSessionUrl(token, origin);
            }
            session.invalidate();
        }
        Map<String,Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        if (endSessionUrl != null) res.put("endSessionUrl", endSessionUrl);
        return res;
    }
    @PostMapping("/api/auth/forgot-password")
    Object forgot(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        limits.check("forgot:"+request.getRemoteAddr(),5,900);auth.forgot(AuthService.email(body));
        return Map.of("message","If the account exists, a reset email will be sent");
    }
    @PostMapping("/api/auth/reset-password")
    Object reset(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        limits.check("reset:"+request.getRemoteAddr(),10,900);
        auth.reset(Api.text(body,"token",100),AuthService.password(body));return Map.of("ok",true);
    }
    @PostMapping("/api/me/password")
    Object changePassword(@RequestBody Map<String,Object> body,Authentication authentication) {
        Actor actor=Actor.of(authentication);
        limits.check("password-change:"+actor.id(),10,900);
        return auth.changePassword(actor.id(),body);
    }
    @GetMapping("/api/me")
    Object me(Authentication authentication){return auth.me(Actor.of(authentication));}

    private void establishSession(HttpServletRequest request, UUID userId) {
        if (userId == null) return;
        HttpSession session = request.getSession(true);
        session.setAttribute(OidcSupport.SESSION_USER_ID, userId);
    }
}
