package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
public class FullscreenController {
    private final FullscreenService fullscreen;private final RateLimits limits;
    public FullscreenController(FullscreenService fullscreen,RateLimits limits){this.fullscreen=fullscreen;this.limits=limits;}
    @PostMapping("/api/runs/{run}/fullscreen-events")
    Object report(Authentication auth,@PathVariable UUID run,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);limits.check("fullscreen:"+actor.id(),120,60);
        fullscreen.report(actor,run,body);return Map.of("ok",true);
    }
    @GetMapping("/api/manage/runs/{run}/fullscreen")
    Object log(Authentication auth,@PathVariable UUID run){return fullscreen.log(Actor.of(auth),run);}
    @GetMapping("/api/manage/fullscreen/alerts")
    Object alerts(Authentication auth,@RequestParam(required=false) String after) {
        return fullscreen.alerts(Actor.of(auth),after==null || after.isBlank()?null:Api.instant(after));
    }
    @GetMapping("/api/manage/runs/{run}/fullscreen/report.xlsx")
    ResponseEntity<byte[]> download(Authentication auth,@PathVariable UUID run) {
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=\"fullscreen-"+run.toString().substring(0,8)+".xlsx\"").body(fullscreen.workbook(Actor.of(auth),run));
    }
}
