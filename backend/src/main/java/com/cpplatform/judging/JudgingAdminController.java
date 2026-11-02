package com.cpplatform.judging;

import com.cpplatform.common.Api;
import com.cpplatform.identity.Actor;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

/** SUPER_ADMIN judging capacity controls. Every change requires a reason and is audited with old/new values. */
@RestController
public class JudgingAdminController {
    private final JudgingSettingsService settings;private final RuntimeAdminService runtimes;
    public JudgingAdminController(JudgingSettingsService settings,RuntimeAdminService runtimes){this.settings=settings;this.runtimes=runtimes;}
    private static Actor admin(Authentication authentication) {
        Actor actor=Actor.of(authentication);Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator permission required");return actor;
    }
    @GetMapping("/api/admin/judging/settings")
    Object read(Authentication auth){admin(auth);return settings.overview();}
    @PatchMapping("/api/admin/judging/settings")
    Object update(Authentication auth,@RequestBody Map<String,Object> body){return settings.update(admin(auth),body);}
    @PatchMapping("/api/admin/judging/workers/{worker}/settings")
    Object worker(Authentication auth,@PathVariable UUID worker,@RequestBody Map<String,Object> body){return settings.updateWorker(admin(auth),worker,body,true);}
    /** Unversioned shortcuts kept for the original drain route; drain state persists across restarts. */
    @PostMapping("/api/admin/judge/workers/{worker}/drain")
    Object drain(Authentication auth,@PathVariable UUID worker,@RequestBody Map<String,Object> body) {
        return settings.updateWorker(admin(auth),worker,Map.of("draining",true,"reason",Api.text(body,"reason",2000)),false);
    }
    @PostMapping("/api/admin/judge/workers/{worker}/resume")
    Object resume(Authentication auth,@PathVariable UUID worker,@RequestBody Map<String,Object> body) {
        return settings.updateWorker(admin(auth),worker,Map.of("draining",false,"reason",Api.text(body,"reason",2000)),false);
    }
    @GetMapping("/api/admin/judge")
    Object judge(Authentication auth){return runtimes.judge(Actor.of(auth));}
    @GetMapping("/api/admin/languages")
    Object languages(Authentication auth){return runtimes.languages(Actor.of(auth));}
    @PutMapping("/api/admin/languages/{language}")
    Object language(Authentication auth,@PathVariable String language,@RequestBody Map<String,Object> body) {
        boolean enabled=Boolean.TRUE.equals(body.get("enabled"));
        runtimes.setLanguage(Actor.of(auth),language,enabled,enabled?Api.text(body,"imageId",80):null,Api.text(body,"reason",2000));return Map.of("ok",true);
    }
}
