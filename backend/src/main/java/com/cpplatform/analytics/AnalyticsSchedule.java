package com.cpplatform.analytics;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
@Component
@ConditionalOnProperty(name="cp.scheduling.enabled",havingValue="true",matchIfMissing=true)
public class AnalyticsSchedule {
    private final AnalyticsService analytics;
    public AnalyticsSchedule(AnalyticsService analytics){this.analytics=analytics;}
    @Scheduled(fixedDelay=60000,initialDelay=15000) public void sample(){analytics.sample();}
    /** Daily report of the previous UTC day; the startup run catches up on days missed while the server was down. */
    @Scheduled(cron="0 5 0 * * *",zone="UTC") public void daily(){analytics.closeDays();}
    @Scheduled(initialDelay=30000,fixedDelay=Long.MAX_VALUE) public void catchUp(){analytics.closeDays();}
}
