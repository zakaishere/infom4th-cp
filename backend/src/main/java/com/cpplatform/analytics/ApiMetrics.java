package com.cpplatform.analytics;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerMapping;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/**
 * Counts HTTP requests for the analytics screen, in process and without touching the database.
 *
 * Two views, both limited to the last {@link #WINDOW_MINUTES} minutes so memory stays bounded:
 * a per-second counter for the live rate, and one slice per minute of per-endpoint totals. Requests
 * that never reach the database — rejected admissions (429), bad credentials (401), server errors —
 * are counted too, which is the point: overload otherwise looks like low traffic.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class ApiMetrics implements Filter {
    static final int WINDOW_MINUTES = 15;
    private static final int SECONDS = WINDOW_MINUTES * 60;
    private static final int MAX_PATHS = 400;

    private final AtomicLongArray perSecond = new AtomicLongArray(SECONDS);
    private final AtomicLongArray clientPerSecond = new AtomicLongArray(SECONDS);
    private final AtomicLongArray serverPerSecond = new AtomicLongArray(SECONDS);
    private final long[] secondStamp = new long[SECONDS];
    private final Object secondLock = new Object();

    private final ArrayDeque<Slice> slices = new ArrayDeque<>();

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) throws IOException, ServletException {
        if (!(request instanceof HttpServletRequest http)) { chain.doFilter(request, response); return; }
        String path = http.getRequestURI();
        boolean tracked = path.startsWith("/api/") || path.startsWith("/internal/");
        long started = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            // Count what the client got, including rejections that never reached a controller.
            if (tracked) record(http, ((HttpServletResponse) response).getStatus(), (System.nanoTime() - started) / 1_000_000);
        }
    }

    void record(HttpServletRequest request, int status, long millis) {
        long now = System.currentTimeMillis();
        long second = now / 1000;
        int slot = (int) (second % SECONDS);
        synchronized (secondLock) {
            if (secondStamp[slot] != second) {
                secondStamp[slot] = second;
                perSecond.set(slot, 0);
                clientPerSecond.set(slot, 0);
                serverPerSecond.set(slot, 0);
            }
        }
        perSecond.incrementAndGet(slot);
        if (status >= 500) serverPerSecond.incrementAndGet(slot);
        else if (status >= 400) clientPerSecond.incrementAndGet(slot);
        slice(now / 60_000).record(key(request), status, millis);
    }

    /** The matched route when Spring has one, so /api/submissions/<uuid> is one row and not thousands. */
    private static String key(HttpServletRequest request) {
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        if (pattern != null) return String.valueOf(pattern);
        String path = request.getRequestURI();
        if (path.length() > 120) path = path.substring(0, 120);
        return path.replaceAll("/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", "/{id}")
                .replaceAll("/\\d+", "/{n}");
    }

    private Slice slice(long minute) {
        synchronized (slices) {
            Slice last = slices.peekLast();
            if (last == null || last.minute != minute) {
                slices.addLast(new Slice(minute));
                while (slices.size() > WINDOW_MINUTES) slices.removeFirst();
                last = slices.peekLast();
            }
            return last;
        }
    }

    /** Rates, errors and endpoint totals for the last {@code minutes}, bucket size chosen for roughly 240 points. */
    public Map<String, Object> summary(int minutes) {
        int span = Math.max(1, Math.min(minutes, WINDOW_MINUTES));
        long nowSecond = System.currentTimeMillis() / 1000;
        long fromSecond = nowSecond - span * 60L;
        int bucket = Math.max(5, span * 60 / 240);
        long first = (fromSecond / bucket) * bucket;

        List<Map<String, Object>> buckets = new ArrayList<>();
        long peak = 0;
        for (long start = first; start <= nowSecond; start += bucket) {
            long requests = 0, client = 0, server = 0;
            long end = Math.min(start + bucket, nowSecond + 1);
            for (long t = Math.max(start, fromSecond); t < end; t++) {
                int slot = (int) (t % SECONDS);
                if (secondStamp[slot] != t) continue;
                requests += perSecond.get(slot);
                client += clientPerSecond.get(slot);
                server += serverPerSecond.get(slot);
            }
            peak = Math.max(peak, requests * 60 / bucket);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("at", Instant.ofEpochSecond(start).toString());
            row.put("requests", requests);
            row.put("rps", round(requests * 1.0 / bucket));
            row.put("clientErrors", client);
            row.put("serverErrors", server);
            buckets.add(row);
        }

        long minuteNow = System.currentTimeMillis() / 60_000;
        long minuteFrom = minuteNow - span + 1;
        Stat totals = new Stat();
        Map<String, Stat> paths = new LinkedHashMap<>();
        synchronized (slices) {
            for (Slice slice : slices) {
                if (slice.minute < minuteFrom) continue;
                totals.merge(slice.other);
                slice.stats.forEach((path, stat) -> { totals.merge(stat); paths.computeIfAbsent(path, p -> new Stat()).merge(stat); });
            }
        }
        List<Map<String, Object>> endpoints = new ArrayList<>();
        paths.forEach((path, stat) -> endpoints.add(stat.row(path)));
        endpoints.sort((a, b) -> Long.compare(((Number) b.get("requests")).longValue(), ((Number) a.get("requests")).longValue()));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("windowMinutes", span);
        out.put("bucketSeconds", bucket);
        out.put("now", totals.row("all"));
        out.put("peakRps", peak);
        out.put("buckets", buckets);
        out.put("endpoints", endpoints.size() > 40 ? endpoints.subList(0, 40) : endpoints);
        return out;
    }

    private static double round(double value) { return Math.round(value * 100.0) / 100.0; }

    /** Totals for one endpoint (or for the whole window when the key is "all"). */
    private static final class Stat {
        final LongAdder requests = new LongAdder();
        final LongAdder clientErrors = new LongAdder();
        final LongAdder serverErrors = new LongAdder();
        final LongAdder totalMs = new LongAdder();
        final AtomicLong maxMs = new AtomicLong();

        void add(int status, long millis) {
            requests.increment();
            if (status >= 500) serverErrors.increment();
            else if (status >= 400) clientErrors.increment();
            totalMs.add(millis);
            long current = maxMs.get();
            while (millis > current && !maxMs.compareAndSet(current, millis)) current = maxMs.get();
        }

        void merge(Stat other) {
            requests.add(other.requests.sum());
            clientErrors.add(other.clientErrors.sum());
            serverErrors.add(other.serverErrors.sum());
            totalMs.add(other.totalMs.sum());
            long current = maxMs.get();
            while (other.maxMs.get() > current && !maxMs.compareAndSet(current, other.maxMs.get())) current = maxMs.get();
        }

        Map<String, Object> row(String path) {
            long count = requests.sum();
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("path", path);
            row.put("requests", count);
            row.put("clientErrors", clientErrors.sum());
            row.put("serverErrors", serverErrors.sum());
            row.put("avgMs", count == 0 ? 0 : Math.round((double) totalMs.sum() / count));
            row.put("maxMs", maxMs.get());
            return row;
        }
    }

    /** One minute of per-endpoint counters. */
    private static final class Slice {
        final long minute;
        final ConcurrentHashMap<String, Stat> stats = new ConcurrentHashMap<>();
        final Stat other = new Stat();

        Slice(long minute) { this.minute = minute; }

        void record(String path, int status, long millis) {
            Stat stat = stats.get(path);
            if (stat == null) {
                if (stats.size() >= MAX_PATHS) stat = other;
                else {
                    Stat created = new Stat();
                    Stat existing = stats.putIfAbsent(path, created);
                    stat = existing == null ? created : existing;
                }
            }
            stat.add(status, millis);
        }
    }
}
