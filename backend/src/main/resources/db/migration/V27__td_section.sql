-- Academic section: practice problems that belong to a TD (travaux dirigés) session. They are
-- judged like practice problems but listed on their own page, grouped by TD number and ordered by
-- position inside the TD, and kept out of the general practice list.
ALTER TABLE practice_publications
    ADD COLUMN td_number smallint CHECK (td_number BETWEEN 1 AND 99),
    ADD COLUMN td_position smallint NOT NULL DEFAULT 0 CHECK (td_position BETWEEN 0 AND 999);

CREATE INDEX practice_publications_td ON practice_publications(td_number, td_position) WHERE td_number IS NOT NULL;
