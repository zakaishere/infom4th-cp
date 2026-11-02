package com.cpplatform.identity;

import com.cpplatform.common.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
public class AuthController {
    private final AuthService auth; private final RateLimits limits;
    public AuthController(AuthService auth,RateLimits limits) {this.auth=auth;this.limits=limits;}
    @PostMapping("/api/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    Object register(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        limits.check("register:"+request.getRemoteAddr(),250,3600);return auth.register(body);
    }
    @PostMapping("/api/auth/login")
    Object login(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        limits.check("login-ip:"+request.getRemoteAddr(),120,60);
        limits.check("login-user:"+AuthService.email(body),10,60);return auth.login(body);
    }
    @PostMapping("/api/auth/refresh")
    Object refresh(@RequestBody Map<String,Object> body,HttpServletRequest request) {
        limits.check("refresh:"+request.getRemoteAddr(),120,60);
        return auth.refresh(Api.text(body,"refreshToken",100)).orElseThrow(()->new org.springframework.web.server.ResponseStatusException(HttpStatus.UNAUTHORIZED,"Invalid refresh token"));
    }
    @PostMapping("/api/auth/logout")
    Object logout(@RequestBody Map<String,Object> body,Authentication authentication) {
        auth.logout(Actor.of(authentication),Api.text(body,"refreshToken",100));return Map.of("ok",true);
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
}
