package com.cpplatform.competition;

import com.cpplatform.identity.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;

@RestController
public class LeaderboardController {
    private final LeaderboardService leaderboard;
    public LeaderboardController(LeaderboardService leaderboard){this.leaderboard=leaderboard;}
    @GetMapping("/api/leaderboard")
    Object leaderboard(Authentication auth){return leaderboard.get(Actor.of(auth));}
}
