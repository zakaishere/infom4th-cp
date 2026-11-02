package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import java.util.*;

@RestController
public class ProfileController {
    private final ProfileService profiles;private final RateLimits limits;private final CompetitionService contests;
    public ProfileController(ProfileService profiles,RateLimits limits,CompetitionService contests){this.profiles=profiles;this.limits=limits;this.contests=contests;}
    @GetMapping("/api/profiles/{handle}")
    Object profile(Authentication auth,@PathVariable String handle){return profiles.profile(Actor.of(auth),handle);}
    @GetMapping("/api/profiles/{first}/vs/{second}")
    Object headToHead(@PathVariable String first,@PathVariable String second){return profiles.headToHead(first,second);}
    @GetMapping("/api/profiles/{handle}/contests/{run}/replay")
    Object replay(@PathVariable String handle,@PathVariable UUID run){return profiles.replay(handle,run);}
    @PatchMapping("/api/me/profile")
    Object update(Authentication auth,@RequestBody Map<String,Object> body) {
        Actor actor=Actor.of(auth);limits.check("profile-edit:"+actor.id(),30,900);
        profiles.update(actor,body);return Map.of("ok",true);
    }
    @GetMapping("/api/me/rivals")
    Object rivals(Authentication auth){return profiles.rivals(Actor.of(auth));}
    @GetMapping("/api/me/rivals/handles")
    Object rivalHandles(Authentication auth){return profiles.rivalHandles(Actor.of(auth));}
    @PutMapping("/api/me/rivals/{handle}")
    Object addRival(Authentication auth,@PathVariable String handle){profiles.addRival(Actor.of(auth),handle);return Map.of("ok",true);}
    @DeleteMapping("/api/me/rivals/{handle}")
    Object removeRival(Authentication auth,@PathVariable String handle){profiles.removeRival(Actor.of(auth),handle);return Map.of("ok",true);}
    @GetMapping("/api/teams/{team}/profile")
    Object team(@PathVariable UUID team){return profiles.team(team);}
    /** Keeps a contest out of the rating or brings it back; the rating recalculates from saved results. */
    @PostMapping("/api/manage/competitions/{id}/rated")
    Object rated(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body) {
        boolean rated=Boolean.TRUE.equals(body.get("rated"));
        contests.setRated(Actor.of(auth),id,rated,Api.optional(body,"reason","Rating setting",2000));return Map.of("rated",rated);
    }
}
