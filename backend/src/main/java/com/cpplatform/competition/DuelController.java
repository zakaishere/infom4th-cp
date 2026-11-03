package com.cpplatform.competition;

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
    @PostMapping("/api/duels/{id}/join")
    Object join(Authentication auth,@PathVariable UUID id){duels.join(Actor.of(auth),id);return Map.of("ok",true);}
    /** Cancels an open challenge, or forfeits a running duel. */
    @PostMapping("/api/duels/{id}/leave")
    Object leave(Authentication auth,@PathVariable UUID id){duels.leave(Actor.of(auth),id);return Map.of("ok",true);}
    @GetMapping("/api/duels/{id}/rounds/{number}")
    Object problem(Authentication auth,@PathVariable UUID id,@PathVariable int number){return duels.problem(Actor.of(auth),id,number);}
    @PostMapping("/api/duels/{id}/submissions") @ResponseStatus(HttpStatus.ACCEPTED)
    Object submit(Authentication auth,@PathVariable UUID id,@RequestHeader("Idempotency-Key") UUID key,@RequestBody Map<String,Object> body) {
        return Map.of("submissionId",duels.submit(Actor.of(auth),id,key,body),"status","QUEUED");
    }
}
