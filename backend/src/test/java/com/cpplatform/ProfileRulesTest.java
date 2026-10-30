package com.cpplatform;

import com.cpplatform.competition.*;
import org.junit.jupiter.api.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Rating, badge and statistics rules without a database. */
class ProfileRulesTest {
    static final Instant T=Instant.parse("2026-10-15T10:00:00Z");
    final UUID a=UUID.randomUUID(),b=UUID.randomUUID(),c=UUID.randomUUID(),run=UUID.randomUUID();
    static Rating.Entrant entrant(int rank,UUID... members){return new Rating.Entrant(UUID.randomUUID(),rank,List.of(members));}
    static int last(Map<UUID,List<Rating.Change>> history,UUID user){var h=history.get(user);return h.get(h.size()-1).after();}

    @Test void winnersGainAndLosersLoseTheSameFromEqualRatings() {
        var history=Rating.calculate(List.of(new Rating.Contest(run,List.of(entrant(1,a),entrant(2,b)))));
        assertEquals(1240,last(history,a));
        assertEquals(1160,last(history,b));
    }
    @Test void aContestNeedsTwoEntrantsToRateAnyone() {
        assertTrue(Rating.calculate(List.of(new Rating.Contest(run,List.of(entrant(1,a))))).isEmpty());
    }
    @Test void aFavouriteWhoWinsGainsLess() {
        var contests=new ArrayList<Rating.Contest>();
        for(int i=0;i<5;i++)contests.add(new Rating.Contest(UUID.randomUUID(),List.of(entrant(1,a),entrant(2,b))));
        var history=Rating.calculate(contests);
        var changes=history.get(a);
        int firstGain=changes.get(0).after()-changes.get(0).before(),lastGain=changes.get(4).after()-changes.get(4).before();
        assertTrue(lastGain<firstGain,firstGain+" then "+lastGain);
    }
    @Test void everyTeamMemberReceivesTheTeamsResult() {
        var history=Rating.calculate(List.of(new Rating.Contest(run,List.of(entrant(1,a,b),entrant(2,c)))));
        assertEquals(last(history,a),last(history,b));
        assertTrue(last(history,a)>Rating.START);
        assertTrue(last(history,c)<Rating.START);
    }

    static ContestScoring.Submission sub(UUID entry,int slot,Instant at,String verdict){return new ContestScoring.Submission(UUID.randomUUID(),entry,slot,at,verdict,1,1);}
    static ContestScoring.Board board(List<UUID> entries,List<Integer> slots,List<ContestScoring.Submission> subs,Instant freeze) {
        return ContestScoring.calculate("ICPC",entries,slots,Map.of(),subs,T,freeze,1200,false);
    }
    @Test void contestSummaryAwardsFirstSolvesCleanSheetsBuzzerAndFreezeClimb() {
        Instant ends=T.plusSeconds(3600),freeze=ends.minusSeconds(600);
        var slots=List.of(1,2,3);
        var subs=List.of(
                sub(a,1,T.plusSeconds(60),"ACCEPTED"),sub(a,2,T.plusSeconds(120),"ACCEPTED"),sub(a,3,T.plusSeconds(180),"ACCEPTED"),
                sub(b,1,T.plusSeconds(90),"WRONG_ANSWER"),sub(b,1,T.plusSeconds(100),"ACCEPTED"),sub(b,2,ends.minusSeconds(10),"ACCEPTED"),sub(b,3,ends.minusSeconds(5),"ACCEPTED"),
                sub(c,1,T.plusSeconds(200),"ACCEPTED"));
        var all=ContestResults.summarize(board(List.of(a,b,c),slots,subs,null),board(List.of(a,b,c),slots,subs,freeze),subs,ends);
        Map<UUID,ContestResults.Result> by=new HashMap<>();
        for(var r:all)by.put(r.entry(),r);
        assertEquals(3,by.get(a).firstBloods());
        assertTrue(by.get(a).cleanSheet());
        assertFalse(by.get(b).cleanSheet(),"a wrong attempt ends the clean sheet");
        assertTrue(by.get(b).buzzerBeater());
        assertFalse(by.get(a).buzzerBeater());
        assertEquals(4,by.get(b).submissions());
        // At the freeze b had 1 solve, tied with c but with penalty; afterwards a clear second.
        assertEquals(by.get(b).rank()==2,by.get(b).freezeBreaker());
    }
    @Test void aCleanSheetNeedsAtLeastThreeProblems() {
        var subs=List.of(sub(a,1,T.plusSeconds(60),"ACCEPTED"));
        var all=ContestResults.summarize(board(List.of(a),List.of(1),subs,null),null,subs,T.plusSeconds(3600));
        assertFalse(all.get(0).cleanSheet());
    }

    static final ZoneId UTC=ZoneId.of("UTC");
    final UUID p1=UUID.randomUUID(),p2=UUID.randomUUID(),p3=UUID.randomUUID();
    static ProfileStats.Sub s(int daysAgo,UUID problem,String verdict,String language){return new ProfileStats.Sub(T.minus(Duration.ofDays(daysAgo)),language,problem,"Title","EASY",verdict,50L+daysAgo,1000L+daysAgo);}
    @Test void streaksCountConsecutiveDaysAndTodayStaysOpen() {
        var stats=ProfileStats.calculate(List.of(s(1,p1,"ACCEPTED","CPP"),s(2,p1,"WRONG_ANSWER","CPP"),s(5,p2,"ACCEPTED","CPP"),s(6,p2,"ACCEPTED","CPP"),s(7,p2,"ACCEPTED","CPP")),UTC,T);
        assertEquals(2,stats.get("current_streak"),"yesterday and the day before; today is still open");
        assertEquals(3,stats.get("best_streak"));
        var broken=ProfileStats.calculate(List.of(s(2,p1,"ACCEPTED","CPP")),UTC,T);
        assertEquals(0,broken.get("current_streak"));
    }
    @Test void statsCountDistinctSolvesAndIgnoreUnjudgedVerdicts() {
        var stats=ProfileStats.calculate(List.of(s(1,p1,"ACCEPTED","CPP"),s(2,p1,"ACCEPTED","JAVA"),s(3,p2,"WRONG_ANSWER","CPP"),s(4,p3,null,"CPP")),UTC,T);
        assertEquals(1,stats.get("solved"));
        assertEquals(3,stats.get("tried"));
        assertEquals(4,stats.get("submissions"));
        assertEquals(1L,stats.get("easy"));
        assertEquals(Map.of("title","Title","ms",51L),stats.get("fastest"));
    }
    @Test void sniperCountsFirstTrySolvesInARowAndAWrongFirstAttemptBreaksIt() {
        var subs=List.of(s(9,p1,"ACCEPTED","CPP"),s(8,p2,"ACCEPTED","CPP"),s(7,p3,"WRONG_ANSWER","CPP"),s(6,p3,"ACCEPTED","CPP"),s(5,UUID.randomUUID(),"ACCEPTED","CPP"));
        assertEquals(2,ProfileStats.bestFirstTryStreak(subs));
    }
    @Test void polyglotCountsOnlyAcceptedLanguages() {
        assertEquals(1,ProfileStats.acceptedLanguages(List.of(s(1,p1,"ACCEPTED","CPP"),s(2,p1,"WRONG_ANSWER","RUST"))));
    }
    @Test void tiersFollowSigma() {
        assertEquals("Digit",LeaderboardService.tier(0));
        assertEquals("Variable",LeaderboardService.tier(500));
        assertEquals("Infinity",LeaderboardService.tier(100000));
    }
}
