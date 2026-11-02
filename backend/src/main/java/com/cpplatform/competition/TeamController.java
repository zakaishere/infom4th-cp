package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
@RequestMapping("/api/teams")
public class TeamController {
    private final TeamService teams;
    public TeamController(TeamService teams){this.teams=teams;}
    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    Object create(Authentication auth,@RequestBody Map<String,Object> body) {
        var team=teams.create(Actor.of(auth),Api.text(body,"name",100));
        return Map.of("teamId",team.teamId(),"inviteToken",team.inviteToken());
    }
    @PostMapping("/{team}/invite")
    Object invite(Authentication auth,@PathVariable UUID team){return Map.of("inviteToken",teams.newInvite(Actor.of(auth),team));}
    @PostMapping("/join")
    Object join(Authentication auth,@RequestBody Map<String,Object> body){return Map.of("teamId",teams.join(Actor.of(auth),Api.text(body,"inviteToken",100)));}
    @GetMapping
    Object mine(Authentication auth){return teams.mine(Actor.of(auth));}
}
