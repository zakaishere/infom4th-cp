package com.cpplatform.competition;

import com.cpplatform.identity.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.*;

/** Missions (V28): a TP of practice problems with points, a leaderboard and shareable score cards. */
@RestController
public class MissionController {
    private final MissionService missions;
    public MissionController(MissionService missions){this.missions=missions;}
    @GetMapping("/api/missions")
    Object list(Authentication auth){return Map.of("missions",missions.list(Actor.of(auth)));}
    @GetMapping("/api/missions/{slug}")
    Object detail(Authentication auth,@PathVariable String slug){return missions.detail(Actor.of(auth),slug);}
    @GetMapping("/api/missions/{slug}/card/{handle}")
    Object card(Authentication auth,@PathVariable String slug,@PathVariable String handle){return missions.card(slug,handle);}
    @PatchMapping("/api/manage/missions/{slug}")
    Object update(Authentication auth,@PathVariable String slug,@RequestBody Map<String,Object> body){missions.update(Actor.of(auth),slug,body);return Map.of("ok",true);}
}
