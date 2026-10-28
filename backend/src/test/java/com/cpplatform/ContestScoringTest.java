package com.cpplatform;

import com.cpplatform.competition.ContestScoring;
import com.cpplatform.competition.ContestScoring.Submission;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ContestScoringTest {
    static final Instant START=Instant.parse("2026-01-01T10:00:00Z");
    static final UUID A=new UUID(0,1),B=new UUID(0,2);
    static Submission at(UUID entry,int slot,int minutes,String verdict,int passed,int total) {
        return new Submission(UUID.randomUUID(),entry,slot,START.plusSeconds(minutes*60L),verdict,passed,total);
    }
    static ContestScoring.Board board(String system,List<Submission> subs,Instant freeze) {
        return ContestScoring.calculate(system,List.of(A,B),List.of(1,2),Map.of(),subs,START,freeze,1200,false);
    }

    @Test void icpcCountsSolvedThenTimePlusPenalty() {
        var b=board("ICPC",List.of(at(A,1,10,"WRONG_ANSWER",0,5),at(A,1,20,"ACCEPTED",5,5),at(B,1,15,"ACCEPTED",5,5),at(B,2,90,"COMPILATION_ERROR",0,5)),null);
        assertEquals(B,b.rows().get(0).entry());
        assertEquals(15*60L,b.rows().get(0).penaltySeconds());
        assertEquals(20*60L+1200,b.rows().get(1).penaltySeconds());
        // An unpenalized compilation error is not shown as a try.
        assertEquals(2,b.stats().get(0).solved());assertEquals(0,b.stats().get(1).tried());
    }

    @Test void ioiTakesTheBestPartialScorePerProblemAndSharesRanksOnTies() {
        var b=board("IOI",List.of(at(A,1,5,"WRONG_ANSWER",3,10),at(A,1,30,"TIME_LIMIT_EXCEEDED",7,10),at(A,1,40,"WRONG_ANSWER",2,10),
                at(B,1,10,"ACCEPTED",10,10),at(B,2,10,"COMPILATION_ERROR",0,10),at(A,2,50,"WRONG_ANSWER",3,10)),null);
        var rows=b.rows();
        assertEquals(100.0,rows.get(0).score(),1e-9);
        assertEquals(100.0,rows.get(1).score(),1e-9);
        assertEquals(1,rows.get(1).rank(),"equal totals share the rank");
        assertEquals(70.0,rows.stream().filter(r->r.entry().equals(A)).findFirst().orElseThrow().problems().get(0).score(),1e-9);
        assertNull(rows.get(0).penaltySeconds());
    }

    @Test void codeforcesPointsDecayWithTimeAndWrongAttemptsWithA30PercentFloor() {
        var b=board("CODEFORCES",List.of(at(A,1,25,"WRONG_ANSWER",0,5),at(A,1,50,"ACCEPTED",5,5),at(B,1,600,"ACCEPTED",5,5)),null);
        var a=b.rows().stream().filter(r->r.entry().equals(A)).findFirst().orElseThrow();
        // 500 - 500/250*50 - 50 = 350
        assertEquals(350.0,a.problems().get(0).score(),1e-9);
        var late=b.rows().stream().filter(r->r.entry().equals(B)).findFirst().orElseThrow();
        assertEquals(150.0,late.problems().get(0).score(),1e-9);
        assertEquals(Map.of(1,500,2,1000),b.points());
    }

    @Test void atcoderBreaksTiesByLastScoreTimePlusFiveMinutesPerWrongAttempt() {
        var b=board("ATCODER",List.of(at(A,1,10,"WRONG_ANSWER",0,5),at(A,1,20,"ACCEPTED",5,5),at(B,1,23,"ACCEPTED",5,5)),null);
        assertEquals(B,b.rows().get(0).entry(),"B: 23 min, A: 20 min + 5 min penalty");
        assertEquals(100.0,b.rows().get(0).score(),1e-9);
        assertEquals(25*60L,b.rows().get(1).penaltySeconds());
    }

    @Test void frozenAndPendingSubmissionsNeverScore() {
        var b=board("CODEFORCES",List.of(at(A,1,10,null,0,0),at(B,1,70,"ACCEPTED",5,5)),START.plusSeconds(3600));
        assertTrue(b.rows().stream().allMatch(r->r.score()==0));
        assertTrue(b.rows().stream().filter(r->r.entry().equals(B)).findFirst().orElseThrow().problems().get(0).frozen());
    }
}
