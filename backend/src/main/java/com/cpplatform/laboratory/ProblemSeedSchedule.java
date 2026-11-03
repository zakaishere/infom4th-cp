package com.cpplatform.laboratory;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
@Component
@ConditionalOnProperty(name="cp.scheduling.enabled",havingValue="true",matchIfMissing=true)
public class ProblemSeedSchedule {
    private final ProblemSeeder seeder;
    public ProblemSeedSchedule(ProblemSeeder seeder){this.seeder=seeder;}
    /** Judges register after the backend starts, so seeding retries until every bundled problem is installed. */
    @Scheduled(initialDelay=15000,fixedDelay=20000) public void tick(){seeder.tick();}
}
