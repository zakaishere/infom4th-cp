package com.cpplatform;

import com.cpplatform.competition.IcpcScoring;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class IcpcScoringTest {
    private final UUID a=new UUID(0,1),b=new UUID(0,2);
    private final Instant start=Instant.parse("2026-10-25T10:00:00Z");
    private IcpcScoring.Submission s(UUID entry,int slot,long seconds,String verdict) {
        return new IcpcScoring.Submission(UUID.randomUUID(),entry,slot,start.plusSeconds(seconds),verdict);
    }
    @Test void completionOrderDoesNotChangePenalty() {
        var submissions=List.of(s(a,1,300,"ACCEPTED"),s(a,1,100,"WRONG_ANSWER"),s(a,1,500,"WRONG_ANSWER"));
        var result=IcpcScoring.calculate(List.of(a),List.of(1),submissions,start,null,1200,false).get(0);
        assertEquals(1,result.solved());assertEquals(1500,result.penaltySeconds());assertEquals(2,result.problems().get(0).attempts());
    }
    @Test void solvedCountRanksBeforePenalty() {
        var result=IcpcScoring.calculate(List.of(a,b),List.of(1,2),
                List.of(s(a,1,10,"ACCEPTED"),s(b,1,1000,"ACCEPTED"),s(b,2,2000,"ACCEPTED")),start,null,1200,false);
        assertEquals(b,result.get(0).entry());
    }
    @Test void freezeHidesResultsButMarksFrozenAttempts() {
        var result=IcpcScoring.calculate(List.of(a),List.of(1),
                List.of(s(a,1,600,"ACCEPTED")),start,start.plusSeconds(500),1200,false).get(0);
        assertEquals(0,result.solved());assertTrue(result.problems().get(0).frozen());assertEquals(0,result.penaltySeconds());
    }
    @Test void compilationPenaltyIsConfigurableAndJudgeErrorsNeverPenalize() {
        var submissions=List.of(s(a,1,100,"COMPILATION_ERROR"),s(a,1,200,"JUDGE_ERROR"),s(a,1,300,"ACCEPTED"));
        assertEquals(300,IcpcScoring.calculate(List.of(a),List.of(1),submissions,start,null,1200,false).get(0).penaltySeconds());
        assertEquals(1500,IcpcScoring.calculate(List.of(a),List.of(1),submissions,start,null,1200,true).get(0).penaltySeconds());
    }
    @Test void tiesAreDeterministicAndPendingDoesNotPenalize() {
        var result=IcpcScoring.calculate(List.of(b,a),List.of(1),List.of(s(a,1,100,null)),start,null,1200,false);
        assertEquals(a,result.get(0).entry());assertEquals(0,result.get(0).penaltySeconds());
    }
    @Test void onlyFirstAcceptedCountsAndUnsolvedAttemptsAddNoPenalty() {
        var result=IcpcScoring.calculate(List.of(a),List.of(1,2),
                List.of(s(a,1,100,"ACCEPTED"),s(a,1,200,"ACCEPTED"),s(a,2,50,"WRONG_ANSWER")),start,null,1200,false).get(0);
        assertEquals(1,result.solved());assertEquals(100,result.penaltySeconds());
    }
}
