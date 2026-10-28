package com.cpplatform.common;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;
import java.util.*;

@Component
public class Database {
    public final JdbcTemplate jdbc;
    public Database(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public Map<String,Object> one(String sql, Object... args) {
        var rows = jdbc.queryForList(sql, args);
        Api.require(!rows.isEmpty(), HttpStatus.NOT_FOUND, "Resource not found");
        return rows.get(0);
    }
    public UUID id(String sql, Object... args) { return jdbc.queryForObject(sql, UUID.class, args); }
    public boolean exists(String sql, Object... args) { return Boolean.TRUE.equals(jdbc.queryForObject(sql, Boolean.class, args)); }
    public void audit(UUID actor, String action, String type, UUID id, String reason) {
        jdbc.update("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,reason) VALUES (?,?,?,?,?)",
                actor,action,type,id,reason);
    }
    /** metadata is a JSON object, for example previous and new values of a settings change. */
    public void audit(UUID actor, String action, String type, UUID id, String reason, String metadata) {
        jdbc.update("INSERT INTO audit_logs(actor_id,action,resource_type,resource_id,reason,metadata) VALUES (?,?,?,?,?,?::jsonb)",
                actor,action,type,id,reason,metadata);
    }
}
