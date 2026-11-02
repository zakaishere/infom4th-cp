package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
public class CommunicationsController {
    private final CommunicationsService communications;
    public CommunicationsController(CommunicationsService communications){this.communications=communications;}
    @GetMapping("/api/runs/{run}/announcements")
    Object announcements(Authentication auth,@PathVariable UUID run){return communications.announcements(Actor.of(auth),run);}
    @PostMapping("/api/manage/runs/{run}/announcements") @ResponseStatus(HttpStatus.CREATED)
    Object announce(Authentication auth,@PathVariable UUID run,@RequestBody Map<String,Object> body) {
        return Map.of("announcementId",communications.announce(Actor.of(auth),run,Api.text(body,"title",255),Api.text(body,"body",16000)));
    }
    @PostMapping("/api/runs/{run}/clarifications") @ResponseStatus(HttpStatus.CREATED)
    Object ask(Authentication auth,@PathVariable UUID run,@RequestBody Map<String,Object> body) {
        return Map.of("clarificationId",communications.ask(Actor.of(auth),run,Api.text(body,"question",8000)));
    }
    @GetMapping("/api/runs/{run}/clarifications")
    Object questions(Authentication auth,@PathVariable UUID run){return communications.clarifications(Actor.of(auth),run);}
    @PostMapping("/api/manage/clarifications/{id}/answer")
    Object answer(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        communications.answer(Actor.of(auth),id,Api.text(body,"answer",16000),Boolean.TRUE.equals(body.get("public")));return Map.of("ok",true);
    }
}
