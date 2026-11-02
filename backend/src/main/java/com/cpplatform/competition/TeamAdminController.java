package com.cpplatform.competition;

import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import java.util.*;

/** SUPER_ADMIN view of every team: who is in it and what it played. Read-only; invite tokens are never returned. */
@RestController
public class TeamAdminController {
    private final TeamAdminService teams;
    public TeamAdminController(TeamAdminService teams){this.teams=teams;}
    /** q matches a team name or a member's handle or email; activity is played, never or locked. */
    @GetMapping("/api/admin/teams")
    Object list(Authentication auth,@RequestParam(defaultValue="0") int offset,@RequestParam(required=false) String q,@RequestParam(required=false) String activity) {
        return teams.list(Actor.of(auth),q,activity,offset);
    }
    @GetMapping("/api/admin/teams/{id}")
    Object detail(Authentication auth,@PathVariable UUID id){return teams.detail(Actor.of(auth),id);}
}
