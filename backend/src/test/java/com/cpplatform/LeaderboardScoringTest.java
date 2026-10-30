package com.cpplatform;

import com.cpplatform.competition.LeaderboardService;
import com.cpplatform.competition.LeaderboardService.*;
import org.junit.jupiter.api.*;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Sigma rules without a database. */
class LeaderboardScoringTest {
    static final Instant T=Instant.parse("2026-10-01T10:00:00Z");
    final UUID ana=UUID.randomUUID(),ben=UUID.randomUUID(),cal=UUID.randomUUID(),team=UUID.randomUUID();
    final UUID p1=UUID.randomUUID(),p2=UUID.randomUUID(),p3=UUID.randomUUID();
    static Solve solve(UUID user,UUID problem,String difficulty,int minute){return new Solve(user,problem,difficulty,T.plusSeconds(minute*60L),null);}

    @Test void aProblemPaysOncePerPlayerHoweverOftenItIsSolved() {
        var board=LeaderboardService.calculate(List.of(solve(ana,p1,"EASY",1),solve(ana,p1,"EASY",2),solve(ana,p1,"EASY",3)),List.of(),Set.of(),T);
        assertEquals(1,board.players().get(0).solved());
        assertEquals(100,board.players().get(0).score());
        assertEquals(T.plusSeconds(60),board.players().get(0).lastSolvedAt());
    }

    @Test void rarerProblemsPayMoreAndDifficultySetsTheBase() {
        // Three players: p1 solved by all (no bonus), p2 by one of three (+33%).
        var board=LeaderboardService.calculate(List.of(solve(ana,p1,"MEDIUM",1),solve(ben,p1,"MEDIUM",1),solve(cal,p1,"MEDIUM",1),solve(ana,p2,"HARD",2)),List.of(),Set.of(),T);
        assertEquals(ana,board.players().get(0).key());
        assertEquals(200+535,board.players().get(0).score());
        assertEquals(200,board.players().get(1).score());
        assertEquals(1,board.players().get(0).hard());
    }

    @Test void equalScoresFavourWhoeverGotThereFirst() {
        var board=LeaderboardService.calculate(List.of(solve(ana,p1,"EASY",9),solve(ben,p2,"EASY",3)),List.of(),Set.of(),T);
        assertEquals(List.of(ben,ana),board.players().stream().map(Row::key).toList());
        assertEquals(List.of(1,2),board.players().stream().map(Row::rank).toList());
    }

    @Test void teamsEarnFromTeamContestsAndFromMembersOnlyAfterTheyJoined() {
        var members=List.of(new Membership(ana,team,T.plusSeconds(300)),new Membership(ben,team,T));
        var board=LeaderboardService.calculate(List.of(
                solve(ana,p1,"EASY",1),// before ana joined: stays with ana only
                solve(ben,p2,"EASY",6),
                solve(ana,p2,"EASY",7),// both members solved p2: pays the team once
                new Solve(cal,p3,"EASY",T.plusSeconds(600),team)),// former member, made for the team in a contest
                members,Set.of(),T);
        assertEquals(1,board.teams().size());
        assertEquals(2,board.teams().get(0).solved());
        assertEquals(team,board.teams().get(0).key());
    }

    @Test void playersWhoOnlySubmittedShareLastPlaceOnZero() {
        var board=LeaderboardService.calculate(List.of(solve(ana,p1,"EASY",1)),List.of(),Set.of(ana,ben,cal),T);
        assertEquals(ana,board.players().get(0).key());
        assertEquals(List.of(1,2,2),board.players().stream().map(Row::rank).toList());
        assertEquals(0,board.players().get(2).score());
        assertNull(board.players().get(2).lastSolvedAt());
        // Being on Σ 0 must not change what a problem is worth: ana is still its only player.
        assertEquals(100,board.players().get(0).score());
        assertTrue(board.teams().isEmpty());
    }

    @Test void nothingSolvedMeansEmptyBoards() {
        var board=LeaderboardService.calculate(List.of(),List.of(new Membership(ana,team,T)),Set.of(),T);
        assertTrue(board.players().isEmpty());
        assertTrue(board.teams().isEmpty());
    }
}
