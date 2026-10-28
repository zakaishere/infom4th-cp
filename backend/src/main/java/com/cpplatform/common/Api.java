package com.cpplatform.common;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.*;

public final class Api {
    private Api() {}
    public static void require(boolean condition, HttpStatus status, String message) {
        if (!condition) throw new ResponseStatusException(status, message);
    }
    public static String text(Map<String, Object> body, String key, int max) {
        Object value = body.get(key);
        require(value instanceof String, HttpStatus.BAD_REQUEST, key + " is required");
        String result = (String) value;
        require(!result.isBlank() && result.length() <= max, HttpStatus.BAD_REQUEST, "Invalid " + key);
        return result;
    }
    public static String optional(Map<String, Object> body, String key, String fallback, int max) {
        return body.containsKey(key) ? text(body, key, max) : fallback;
    }
    public static int number(Map<String, Object> body, String key, int fallback, int min, int max) {
        Object value = body.getOrDefault(key, fallback);
        require(value instanceof Number && ((Number)value).doubleValue() == ((Number)value).intValue(),
                HttpStatus.BAD_REQUEST, "Invalid " + key);
        int result = ((Number)value).intValue();
        require(result >= min && result <= max, HttpStatus.BAD_REQUEST, "Invalid " + key);
        return result;
    }
    public static UUID uuid(Object value) {
        try { return UUID.fromString(String.valueOf(value)); }
        catch (IllegalArgumentException e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid identifier"); }
    }
    public static Instant instant(Object value) {
        try { return Instant.parse(String.valueOf(value)); }
        catch (Exception e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Use an ISO-8601 UTC timestamp"); }
    }
    public static Instant time(Object value) {
        return value instanceof Timestamp t ? t.toInstant() : ((java.time.OffsetDateTime)value).toInstant();
    }
    public static List<String> languages(Map<String,Object> body) {
        Object value = body.get("languages");
        require(value instanceof List<?> && !((List<?>)value).isEmpty() && ((List<?>)value).size() <= 16,
                HttpStatus.BAD_REQUEST, "Specify supported languages");
        return ((List<?>)value).stream().map(Object::toString).distinct().toList();
    }
}
