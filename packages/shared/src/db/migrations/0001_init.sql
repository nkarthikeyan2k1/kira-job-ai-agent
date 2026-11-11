-- 0001_init: full initial schema.
-- Enum-like columns are text + a named CHECK; the value lists mirror
-- packages/shared/src/enums.ts (an integration test compares the two).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Companies: synced from apps/agent/config/companies.json (id = its slug).
-- ---------------------------------------------------------------------------
CREATE TABLE companies (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  ats         text NOT NULL,
  ats_key     text NOT NULL,
  ats_config  jsonb NOT NULL DEFAULT '{}',
  careers_url text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  tier        smallint NOT NULL DEFAULT 2,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_ats_check CHECK (ats IN ('greenhouse', 'lever', 'ashby', 'workday', 'scrape')),
  CONSTRAINT companies_tier_check CHECK (tier BETWEEN 1 AND 3)
);

CREATE TRIGGER companies_set_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Jobs: one row per posting; the full description is archived at first fetch.
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
  id               text PRIMARY KEY,           -- gh:{board}:{id}, wd:{tenant}:{id}
  company_id       text NOT NULL REFERENCES companies (id),
  source           text NOT NULL,
  external_id      text NOT NULL,
  url              text NOT NULL,
  url_normalized   text NOT NULL,
  fingerprint      text NOT NULL,
  title            text NOT NULL,
  location         text,
  location_norm    text,
  remote_type      text,
  seniority        text,
  years_min        smallint,
  salary_min       integer,                    -- only when the posting states it
  salary_max       integer,
  salary_currency  char(3),
  salary_period    text,
  description      text NOT NULL,
  description_hash text NOT NULL,
  posted_at        timestamptz,
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  embedding        vector(768),                -- one vector per job, for the top-N step
  embedding_model  text,                       -- which model produced it; vectors from different models can't be compared
  CONSTRAINT jobs_source_check CHECK (source IN ('greenhouse', 'lever', 'ashby', 'workday', 'scrape')),
  CONSTRAINT jobs_remote_type_check CHECK (remote_type IN ('onsite', 'hybrid', 'remote')),
  CONSTRAINT jobs_seniority_check CHECK (seniority IN ('intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager')),
  CONSTRAINT jobs_salary_period_check CHECK (salary_period IN ('year', 'month', 'hour')),
  CONSTRAINT jobs_years_min_check CHECK (years_min >= 0),
  CONSTRAINT jobs_salary_range_check CHECK (salary_min >= 0 AND salary_max >= salary_min),
  CONSTRAINT jobs_url_normalized_key UNIQUE (url_normalized),
  -- company_id is part of the key: Workday requisition ids repeat across tenants.
  CONSTRAINT jobs_source_company_external_key UNIQUE (source, company_id, external_id)
);

CREATE INDEX jobs_fingerprint_idx ON jobs (fingerprint);
CREATE INDEX jobs_company_last_seen_idx ON jobs (company_id, last_seen);
-- HNSW: a graph index that finds the nearest vectors without comparing against
-- every row. vector_cosine_ops makes it serve the <=> (cosine distance) operator.
CREATE INDEX jobs_embedding_hnsw_idx ON jobs USING hnsw (embedding vector_cosine_ops);

CREATE TABLE job_chunks (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id          text NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  section         text NOT NULL,
  ordinal         integer NOT NULL,
  content         text NOT NULL,
  embedding       vector(768),
  embedding_model text,
  CONSTRAINT job_chunks_section_check CHECK (section IN ('requirements', 'responsibilities', 'about', 'benefits', 'other')),
  CONSTRAINT job_chunks_job_section_ordinal_key UNIQUE (job_id, section, ordinal)
);

CREATE INDEX job_chunks_embedding_hnsw_idx ON job_chunks USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Resume: versions + chunks. No vector index on resume_chunks: with a few
-- dozen rows a full scan is faster than any index.
-- ---------------------------------------------------------------------------
CREATE TABLE resume_versions (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label        text NOT NULL,
  source_path  text,
  content      text NOT NULL,
  content_hash text NOT NULL,
  is_active    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resume_versions_content_hash_key UNIQUE (content_hash)
);

CREATE UNIQUE INDEX resume_versions_one_active_idx ON resume_versions (is_active) WHERE is_active;

CREATE TABLE resume_chunks (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resume_version_id integer NOT NULL REFERENCES resume_versions (id) ON DELETE CASCADE,
  section           text NOT NULL,
  ordinal           integer NOT NULL,
  content           text NOT NULL,
  embedding         vector(768),
  embedding_model   text,
  CONSTRAINT resume_chunks_section_check CHECK (section IN ('summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'other')),
  CONSTRAINT resume_chunks_version_section_ordinal_key UNIQUE (resume_version_id, section, ordinal)
);

-- ---------------------------------------------------------------------------
-- Matches: append-only score history; exactly one current row per job.
-- ---------------------------------------------------------------------------
CREATE TABLE matches (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id             text NOT NULL REFERENCES jobs (id),
  resume_version_id  integer NOT NULL REFERENCES resume_versions (id),
  is_current         boolean NOT NULL DEFAULT true,
  hard_filter_result jsonb NOT NULL,           -- { passed, failed: [{ rule, detail }] }
  similarity         real,
  similarity_norm    real,
  llm_score          smallint,
  final_score        real,                     -- 0–100
  breakdown          jsonb NOT NULL DEFAULT '[]',
  adjustments        jsonb NOT NULL DEFAULT '[]',
  matched_skills     text[] NOT NULL DEFAULT '{}',
  missing_skills     text[] NOT NULL DEFAULT '{}',
  reason             text,
  model              text,
  prompt_version     text,
  scored_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_similarity_check CHECK (similarity BETWEEN 0 AND 1),
  CONSTRAINT matches_similarity_norm_check CHECK (similarity_norm BETWEEN 0 AND 1),
  CONSTRAINT matches_llm_score_check CHECK (llm_score BETWEEN 0 AND 100),
  CONSTRAINT matches_final_score_check CHECK (final_score BETWEEN 0 AND 100),
  -- A job that failed a hard filter is never scored.
  CONSTRAINT matches_filtered_not_scored_check
    CHECK ((hard_filter_result ->> 'passed')::boolean OR final_score IS NULL)
);

CREATE UNIQUE INDEX matches_one_current_per_job_idx ON matches (job_id) WHERE is_current;
CREATE INDEX matches_current_final_score_idx ON matches (final_score DESC) WHERE is_current;

-- ---------------------------------------------------------------------------
-- Applications: created when a job is shortlisted. History lives in
-- application_events and is never overwritten.
-- ---------------------------------------------------------------------------
CREATE TABLE applications (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id            text NOT NULL REFERENCES jobs (id),
  status            text NOT NULL DEFAULT 'shortlisted',
  applied_at        timestamptz,
  next_follow_up_at timestamptz,
  follow_up_count   smallint NOT NULL DEFAULT 0,
  resume_path       text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applications_job_id_key UNIQUE (job_id),
  CONSTRAINT applications_status_check CHECK (status IN ('shortlisted', 'applied', 'responded', 'interview', 'offer', 'rejected', 'skipped', 'ghosted', 'withdrawn', 'closed')),
  CONSTRAINT applications_follow_up_count_check CHECK (follow_up_count >= 0)
);

CREATE INDEX applications_next_follow_up_idx ON applications (next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;

CREATE TRIGGER applications_set_updated_at BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE application_events (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  from_status    text,
  to_status      text NOT NULL,
  at             timestamptz NOT NULL DEFAULT now(),
  note           text,
  CONSTRAINT application_events_from_status_check CHECK (from_status IN ('shortlisted', 'applied', 'responded', 'interview', 'offer', 'rejected', 'skipped', 'ghosted', 'withdrawn', 'closed')),
  CONSTRAINT application_events_to_status_check CHECK (to_status IN ('shortlisted', 'applied', 'responded', 'interview', 'offer', 'rejected', 'skipped', 'ghosted', 'withdrawn', 'closed'))
);

CREATE INDEX application_events_application_at_idx ON application_events (application_id, at);

-- ---------------------------------------------------------------------------
-- Operations: LLM cost tracking and fetch history.
-- ---------------------------------------------------------------------------
CREATE TABLE llm_calls (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task           text NOT NULL,
  tier           text NOT NULL,
  model          text NOT NULL,
  tokens_in      integer NOT NULL DEFAULT 0,
  tokens_out     integer NOT NULL DEFAULT 0,
  cost_usd       numeric(10, 6) NOT NULL DEFAULT 0,
  latency_ms     integer NOT NULL,
  ok             boolean NOT NULL,
  error          text,
  job_id         text REFERENCES jobs (id) ON DELETE SET NULL,
  prompt_version text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llm_calls_tier_check CHECK (tier IN ('local', 'paid'))
);

-- Serves the daily budget check: sum(cost_usd) of today's paid calls.
CREATE INDEX llm_calls_paid_created_at_idx ON llm_calls (created_at) WHERE tier = 'paid';

CREATE TABLE fetch_runs (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  text NOT NULL REFERENCES companies (id),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  jobs_seen   integer NOT NULL DEFAULT 0,
  jobs_new    integer NOT NULL DEFAULT 0,
  jobs_closed integer NOT NULL DEFAULT 0,
  error       text
);

CREATE INDEX fetch_runs_company_started_idx ON fetch_runs (company_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Profile: a single row (id is always 1).
-- ---------------------------------------------------------------------------
CREATE TABLE profile (
  id                smallint PRIMARY KEY DEFAULT 1,
  target_roles      text[] NOT NULL DEFAULT '{}',
  skills            text[] NOT NULL DEFAULT '{}',
  experience_years  numeric(4, 1),
  seniority         text,
  locations         text[] NOT NULL DEFAULT '{}',
  remote_types      text[] NOT NULL DEFAULT '{}',
  salary_min        integer,
  salary_currency   char(3),
  work_auth         text,
  needs_sponsorship boolean,
  deal_breakers     text[] NOT NULL DEFAULT '{}',
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_single_row_check CHECK (id = 1),
  CONSTRAINT profile_seniority_check CHECK (seniority IN ('intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager')),
  CONSTRAINT profile_remote_types_check CHECK (remote_types <@ ARRAY['onsite', 'hybrid', 'remote'])
);

CREATE TRIGGER profile_set_updated_at BEFORE UPDATE ON profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
