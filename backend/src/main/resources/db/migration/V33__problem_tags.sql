-- Store topic tags (e.g. hash map, math, dp, graphs) directly on problems so they are preserved
-- from creation and bulk import onward, before and after publishing to the Problem Set.
ALTER TABLE problems
    ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT problems_tags_limit CHECK (cardinality(tags) <= 8);

-- Preserve any tags already set on practice_publications.
UPDATE problems p
SET tags = pp.tags
FROM practice_publications pp
WHERE pp.problem_id = p.id AND cardinality(pp.tags) > 0;

-- Automatically backfill curated LeetCode-style topic tags and default contest flags for any
-- already-uploaded example/warmup problems that do not yet have tags or a contest flag.
WITH seed(slug, tags, flag) AS (VALUES
    ('anagram-check', ARRAY['string','hash map'], 'BASIC'),
    ('balanced-brackets', ARRAY['string','stack'], 'WARMUP'),
    ('count-distinct', ARRAY['array','hash map','sorting'], 'BASIC'),
    ('count-set-bits', ARRAY['bit manipulation','math'], 'BASIC'),
    ('even-sum', ARRAY['array','math','implementation'], 'BASIC'),
    ('fibonacci-modulo', ARRAY['math','dp','number theory'], 'BASIC'),
    ('first-occurrence', ARRAY['array','binary search'], 'WARMUP'),
    ('greatest-common-divisor', ARRAY['math','number theory'], 'BASIC'),
    ('grid-shortest-path', ARRAY['graphs','matrix'], 'WARMUP'),
    ('longest-distinct-substring', ARRAY['string','sliding window','hash map'], 'WARMUP'),
    ('maximum-element', ARRAY['array','implementation'], 'BASIC'),
    ('maximum-subarray-sum', ARRAY['array','dp','greedy'], 'WARMUP'),
    ('merge-sorted-arrays', ARRAY['array','two pointers','sorting'], 'BASIC'),
    ('missing-number', ARRAY['array','math'], 'BASIC'),
    ('move-zeroes', ARRAY['array','two pointers'], 'BASIC'),
    ('palindrome-check', ARRAY['string','two pointers'], 'BASIC'),
    ('prime-check', ARRAY['math','number theory'], 'BASIC'),
    ('range-sum-queries', ARRAY['array','prefix sum'], 'WARMUP'),
    ('reverse-array', ARRAY['array','two pointers'], 'BASIC'),
    ('sum-of-two-numbers', ARRAY['math','implementation'], 'BASIC'),
    ('two-sum-exists', ARRAY['array','hash map','two pointers'], 'WARMUP'),
    ('warmup-coin-change-ways', ARRAY['dp','math'], 'WARMUP'),
    ('warmup-delivery-routes', ARRAY['graphs','greedy','data structures'], 'WARMUP'),
    ('warmup-fewest-coins', ARRAY['dp'], 'WARMUP'),
    ('warmup-island-groups', ARRAY['graphs','data structures'], 'WARMUP'),
    ('warmup-longest-increasing', ARRAY['dp','binary search','array'], 'WARMUP'),
    ('warmup-meeting-room', ARRAY['greedy','sorting'], 'WARMUP'),
    ('warmup-most-frequent-word', ARRAY['string','hash map','sorting'], 'WARMUP'),
    ('warmup-power-mod', ARRAY['math','number theory','bit manipulation'], 'WARMUP'),
    ('warmup-rectangle-sums', ARRAY['matrix','prefix sum'], 'WARMUP'),
    ('warmup-second-best', ARRAY['array','implementation'], 'WARMUP'),
    ('warmup-spiral', ARRAY['matrix','implementation'], 'WARMUP'),
    ('warmup-task-order', ARRAY['graphs','data structures'], 'WARMUP'),
    ('bapc24p-awkwardauction', ARRAY['dp','math'], 'WARMUP'),
    ('bapc24p-chaoticcables', ARRAY['graphs','trees','data structures'], 'STANDARD'),
    ('bapc24p-expectederror', ARRAY['math','implementation'], 'WARMUP'),
    ('bapc24p-humanpyramid', ARRAY['math','binary search'], 'WARMUP'),
    ('fpc22-cakepromise', ARRAY['array','sorting','implementation'], 'WARMUP'),
    ('fpc22-dalenchip', ARRAY['math','greedy'], 'WARMUP'),
    ('fpc22-eurovision', ARRAY['sorting','hash map','implementation'], 'STANDARD'),
    ('fpc22-glassreflection', ARRAY['string','implementation'], 'WARMUP'),
    ('fpc22-highwaysofthefuture', ARRAY['graphs','dp'], 'STANDARD'),
    ('fpc22-inspiringprofessors', ARRAY['greedy','sorting','data structures'], 'STANDARD'),
    ('fpc23-felinefriendship', ARRAY['graphs','math'], 'STANDARD'),
    ('fpc23-huntingthemavericks', ARRAY['graphs','dp'], 'WARMUP'),
    ('fpc23-industryimprovements', ARRAY['binary search','greedy','array'], 'WARMUP'),
    ('fpc24-annoyingalliterations', ARRAY['string','hash map','dp'], 'STANDARD'),
    ('fpc24-curiousjury', ARRAY['array','sorting','math'], 'WARMUP'),
    ('fpc24-draggedoutduel', ARRAY['string','implementation'], 'WARMUP'),
    ('fpc24-europeanelection', ARRAY['graphs','array','brute force'], 'WARMUP'),
    ('fpc24-intelligenceepxloration', ARRAY['graphs','implementation'], 'WARMUP'),
    ('fpc24-jailbreak', ARRAY['graphs','matrix'], 'WARMUP'),
    ('fpc25-arrayannihilation', ARRAY['array','data structures','greedy'], 'WARMUP'),
    ('fpc25-characterithmetic', ARRAY['string','math','brute force'], 'STANDARD'),
    ('fpc25-gamblersdilemma', ARRAY['math','brute force'], 'WARMUP'),
    ('fpc25-hopelesslyhungover', ARRAY['dp','greedy','array'], 'WARMUP'),
    ('fpc25-interestingmountains', ARRAY['array','stack','math'], 'STANDARD'),
    ('fpc25-jumbledkeys', ARRAY['string','hash map','implementation'], 'WARMUP')
)
UPDATE problems p
SET tags = CASE WHEN cardinality(p.tags) = 0 THEN seed.tags ELSE p.tags END,
    contest_flag = COALESCE(p.contest_flag, seed.flag)
FROM seed
WHERE p.slug = seed.slug;

-- Mirror the newly backfilled tags onto practice_publications where tags are still empty.
UPDATE practice_publications pp
SET tags = p.tags
FROM problems p
WHERE pp.problem_id = p.id
  AND cardinality(pp.tags) = 0
  AND cardinality(p.tags) > 0;
