package com.cpplatform.competition;

import com.cpplatform.common.*;
import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
public class DuelController {
    private final DuelService duels;
    public DuelController(DuelService duels){this.duels=duels;}
    @GetMapping("/api/duels")
    Object list(Authentication auth){return duels.list(Actor.of(auth));}
    @PostMapping("/api/duels") @ResponseStatus(HttpStatus.CREATED)
    Object create(Authentication auth,@RequestBody Map<String,Object> body){return Map.of("duelId",duels.create(Actor.of(auth),body));}
    @GetMapping("/api/duels/{id}")
    Object state(Authentication auth,@PathVariable UUID id){return duels.state(Actor.of(auth),id);}
    /** body.team (1 or 2) picks a team in a team room; otherwise the smaller team. */
    @PostMapping("/api/duels/{id}/join")
    Object join(Authentication auth,@PathVariable UUID id,@RequestBody(required=false) Map<String,Object> body) {
        Integer team=body!=null && body.get("team")!=null?Api.number(body,"team",1,1,2):null;
        duels.join(Actor.of(auth),id,team);return Map.of("ok",true);
    }
    /** The host starts a room before it is full. */
    @PostMapping("/api/duels/{id}/start")
    Object start(Authentication auth,@PathVariable UUID id){duels.start(Actor.of(auth),id);return Map.of("ok",true);}
    @PostMapping("/api/duels/{id}/team")
    Object team(Authentication auth,@PathVariable UUID id,@RequestBody Map<String,Object> body){duels.team(Actor.of(auth),id,Api.number(body,"team",1,1,2));return Map.of("ok",true);}
    /** Cancels (host) or leaves an open room, or forfeits a running one. */
    @PostMapping("/api/duels/{id}/leave")
    Object leave(Authentication auth,@PathVariable UUID id){duels.leave(Actor.of(auth),id);return Map.of("ok",true);}
    @GetMapping("/api/duels/{id}/rounds/{number}")
    Object problem(Authentication auth,@PathVariable UUID id,@PathVariable int number){return duels.problem(Actor.of(auth),id,number);}
    /** Organizer view of the duel problem pool. */
    @GetMapping("/api/manage/duel-problems")
    Object manage(Authentication auth){return duels.manage(Actor.of(auth));}
    @PatchMapping("/api/manage/duel-problems/{problem}")
    Object update(Authentication auth,@PathVariable UUID problem,@RequestBody Map<String,Object> body){duels.update(Actor.of(auth),problem,body);return Map.of("ok",true);}
    /** body.mode=samples runs the statement's examples only ("Run examples"); it never counts in the room. */
    @PostMapping("/api/duels/{id}/submissions") @ResponseStatus(HttpStatus.ACCEPTED)
    Object submit(Authentication auth,@PathVariable UUID id,@RequestHeader("Idempotency-Key") UUID key,@RequestBody Map<String,Object> body) {
        return Map.of("submissionId",duels.submit(Actor.of(auth),id,key,body),"status","QUEUED");
    }
}
