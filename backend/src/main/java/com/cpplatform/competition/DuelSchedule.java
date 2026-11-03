package com.cpplatform.competition;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
@Component
@ConditionalOnProperty(name="cp.scheduling.enabled",havingValue="true",matchIfMissing=true)
public class DuelSchedule {
    private final DuelService service;
    public DuelSchedule(DuelService service){this.service=service;}
    @Scheduled(fixedDelay=1000) public void tick(){service.tick();}
}
