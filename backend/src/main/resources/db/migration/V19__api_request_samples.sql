-- One row per minute of HTTP traffic. The API meter itself lives in memory; this keeps the
-- history across restarts and lets a whole contest be reviewed. Retention: 14 days.
CREATE TABLE api_request_samples (
    id bigserial PRIMARY KEY,
    sampled_at timestamptz NOT NULL DEFAULT now(),
    requests bigint NOT NULL DEFAULT 0,
    client_errors bigint NOT NULL DEFAULT 0,
    server_errors bigint NOT NULL DEFAULT 0,
    total_ms bigint NOT NULL DEFAULT 0,
    max_ms integer NOT NULL DEFAULT 0
);
CREATE INDEX api_request_samples_time ON api_request_samples(sampled_at);
