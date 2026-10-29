package com.cpplatform.analytics;

import com.cpplatform.common.Api;
import com.cpplatform.identity.Actor;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import java.time.*;
import java.util.*;

/** Platform-wide analytics are SUPER_ADMIN only; contest analytics follow contest management access. */
@RestController
public class AnalyticsController {
    private final AnalyticsService analytics;
    public AnalyticsController(AnalyticsService analytics){this.analytics=analytics;}
    private static Actor admin(Authentication authentication) {
        Actor actor=Actor.of(authentication);Api.require(actor.superAdmin(),HttpStatus.FORBIDDEN,"Super administrator permission required");return actor;
    }
    @GetMapping("/api/admin/analytics/overview")
    Object overview(Authentication auth){admin(auth);return analytics.overview();}
    @GetMapping("/api/admin/analytics/timeseries")
    Object timeseries(Authentication auth,@RequestParam(defaultValue="24") int hours) {
        admin(auth);Api.require(hours>=1 && hours<=336,HttpStatus.BAD_REQUEST,"hours must be 1-336");return analytics.timeseries(hours);
    }
    @GetMapping("/api/admin/analytics/daily")
    Object daily(Authentication auth,@RequestParam(defaultValue="30") int days) {
        admin(auth);Api.require(days>=1 && days<=366,HttpStatus.BAD_REQUEST,"days must be 1-366");
        return Map.of("today",analytics.day(LocalDate.now(ZoneOffset.UTC)),"reports",analytics.reports(days));
    }
    @GetMapping("/api/manage/analytics/contests")
    Object contests(Authentication auth){return analytics.contests(Actor.of(auth));}
    @GetMapping("/api/manage/analytics/runs/{id}")
    Object run(Authentication auth,@PathVariable UUID id){return analytics.run(Actor.of(auth),id);}
}
