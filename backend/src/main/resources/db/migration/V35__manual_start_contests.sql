-- Allow publishing a contest for registration without a fixed countdown so the organizer can hit "Start now" whenever ready.
ALTER TABLE contest_runs
    ADD COLUMN manual_start boolean NOT NULL DEFAULT false;
