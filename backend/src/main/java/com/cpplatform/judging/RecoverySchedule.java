package com.cpplatform.judging;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
@Component
@ConditionalOnProperty(name="cp.scheduling.enabled",havingValue="true",matchIfMissing=true)
public class RecoverySchedule {
    private final JudgeService judge;
    public RecoverySchedule(JudgeService judge){this.judge=judge;}
    @Scheduled(fixedDelay=5000) public void tick(){judge.recover();judge.finishValidations();}
}
