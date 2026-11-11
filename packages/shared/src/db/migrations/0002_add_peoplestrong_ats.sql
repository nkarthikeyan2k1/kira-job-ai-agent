-- 0002: PeopleStrong career portals (e.g. BMW TechWorks India) as a job source.

ALTER TABLE companies
  DROP CONSTRAINT companies_ats_check,
  ADD CONSTRAINT companies_ats_check CHECK (ats IN ('greenhouse', 'lever', 'ashby', 'workday', 'peoplestrong', 'scrape'));

ALTER TABLE jobs
  DROP CONSTRAINT jobs_source_check,
  ADD CONSTRAINT jobs_source_check CHECK (source IN ('greenhouse', 'lever', 'ashby', 'workday', 'peoplestrong', 'scrape'));
