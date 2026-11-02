-- When contestants left the contest screen and for how long, for the jury to review.
-- Reported by the browser, so this is evidence to weigh and not proof of anything.
CREATE TABLE fullscreen_events (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL,
    entry_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind varchar(24) NOT NULL CHECK (kind IN ('LEFT_FULLSCREEN', 'LOST_FOCUS', 'FULLSCREEN_REFUSED')),
    reason varchar(24) NOT NULL DEFAULT 'EXITED' CHECK (reason IN ('EXITED', 'PAGE_RELOAD', 'EXIT_BUTTON', 'OTHER_WINDOW', 'BROWSER_REFUSED')),
    left_at timestamptz NOT NULL,
    returned_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (entry_id, run_id, user_id) REFERENCES run_entry_members(entry_id, run_id, user_id),
    CHECK (returned_at IS NULL OR returned_at >= left_at)
);
CREATE INDEX fullscreen_events_run ON fullscreen_events(run_id, left_at DESC);
CREATE INDEX fullscreen_events_recent ON fullscreen_events(left_at DESC);
-- At most one open event of each kind per person: a repeated report changes nothing.
CREATE UNIQUE INDEX fullscreen_events_open ON fullscreen_events(run_id, user_id, kind) WHERE returned_at IS NULL;
