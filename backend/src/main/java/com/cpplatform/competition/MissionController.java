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
    @PostMapping("/api/manage/missions")
    Object create(Authentication auth,@RequestBody Map<String,Object> body){return Map.of("slug",missions.create(Actor.of(auth),body));}
    @GetMapping("/api/manage/missions/candidates")
    Object candidates(Authentication auth){return Map.of("candidates",missions.candidates(Actor.of(auth)));}
    @PostMapping("/api/manage/missions/{slug}/problems")
    Object add(Authentication auth,@PathVariable String slug,@RequestBody Map<String,Object> body){missions.addProblems(Actor.of(auth),slug,body);return Map.of("ok",true);}
    @DeleteMapping("/api/manage/missions/{slug}/problems/{problem}")
    Object remove(Authentication auth,@PathVariable String slug,@PathVariable UUID problem){missions.removeProblem(Actor.of(auth),slug,problem);return Map.of("ok",true);}
    @PatchMapping("/api/manage/missions/{slug}")
    Object update(Authentication auth,@PathVariable String slug,@RequestBody Map<String,Object> body){missions.update(Actor.of(auth),slug,body);return Map.of("ok",true);}
}
