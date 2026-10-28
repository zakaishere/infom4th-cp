package com.cpplatform.identity;

import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;
import com.cpplatform.common.Api;
import java.util.concurrent.ConcurrentHashMap;

/** Per-process guard; deploy behind a shared proxy limit when adding API replicas. */
@Component
public class RateLimits {
    private record Window(long start, int count) {}
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
    public void check(String key, int limit, long seconds) {
        long now = System.currentTimeMillis(), duration = seconds * 1000;
        if (windows.size() > 20000) windows.entrySet().removeIf(e -> now-e.getValue().start > duration);
        Api.require(windows.size() < 25000 || windows.containsKey(key), HttpStatus.TOO_MANY_REQUESTS, "Try again later");
        Window next = windows.compute(key, (k,w) -> w == null || now-w.start >= duration
                ? new Window(now,1) : new Window(w.start,w.count+1));
        Api.require(next.count <= limit, HttpStatus.TOO_MANY_REQUESTS, "Too many requests; try again later");
    }
}
