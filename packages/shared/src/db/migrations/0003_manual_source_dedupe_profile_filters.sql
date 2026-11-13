-- 0003: what stage [2] (dedupe + hard filters) and manual mode need.

-- 1. "manual": a job I pasted myself (e.g. a JD a recruiter sent me).
ALTER TABLE companies
  DROP CONSTRAINT companies_ats_check,
  ADD CONSTRAINT companies_ats_check CHECK (ats IN ('greenhouse', 'lever', 'ashby', 'workday', 'peoplestrong', 'scrape', 'manual'));

ALTER TABLE jobs
  DROP CONSTRAINT jobs_source_check,
  ADD CONSTRAINT jobs_source_check CHECK (source IN ('greenhouse', 'lever', 'ashby', 'workday', 'peoplestrong', 'scrape', 'manual'));

-- 2. Dedupe links. duplicate_of: the same job is already stored (the original
--    is the one that gets filtered and scored). repost_of: this posting
--    reappeared after an identical one was closed (a possible ghost job).
ALTER TABLE jobs
  ADD COLUMN duplicate_of text REFERENCES jobs (id),
  ADD COLUMN repost_of    text REFERENCES jobs (id),
  ADD CONSTRAINT jobs_not_own_duplicate_check CHECK (duplicate_of <> id AND repost_of <> id);

CREATE INDEX jobs_duplicate_of_idx ON jobs (duplicate_of) WHERE duplicate_of IS NOT NULL;

-- 3. Profile: the preferences the hard filters read. The table is still empty,
--    so replacing the free-text work_auth column loses nothing.
ALTER TABLE profile
  DROP COLUMN work_auth,
  ADD COLUMN title_keywords_include text[] NOT NULL DEFAULT '{}',
  ADD COLUMN title_keywords_exclude text[] NOT NULL DEFAULT '{}',
  ADD COLUMN target_seniority       text[] NOT NULL DEFAULT '{}',   -- levels I would apply to
  ADD COLUMN work_auth_countries    text[] NOT NULL DEFAULT '{}',   -- where I can work without sponsorship
  ADD COLUMN notice_period_days     integer,
  ADD CONSTRAINT profile_target_seniority_check
    CHECK (target_seniority <@ ARRAY['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager']),
  ADD CONSTRAINT profile_notice_period_check CHECK (notice_period_days >= 0);

-- 4. A failed hard filter normally forbids a score. Manual jobs are scored
--    anyway (I chose to look at them): their result carries "enforced": false.
ALTER TABLE matches
  DROP CONSTRAINT matches_filtered_not_scored_check,
  ADD CONSTRAINT matches_filtered_not_scored_check CHECK (
    (hard_filter_result ->> 'passed')::boolean
    OR NOT COALESCE((hard_filter_result ->> 'enforced')::boolean, true)
    OR final_score IS NULL
  );
