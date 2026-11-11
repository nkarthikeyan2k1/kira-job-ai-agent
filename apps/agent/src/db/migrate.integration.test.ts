import {
  APPLICATION_STATUSES,
  ATS_TYPES,
  JOB_CHUNK_SECTIONS,
  LLM_TIERS,
  REMOTE_TYPES,
  RESUME_SECTIONS,
  SALARY_PERIODS,
  SENIORITY_LEVELS,
} from "@kira/shared";
import { MIGRATIONS_DIR } from "@kira/shared/db";
import pg from "pg";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationFiles, runMigrations } from "./migrate.ts";
import { TEST_DATABASE_URL, wipeTestDatabase } from "./test-db.ts";

// Runs against a throwaway database and is skipped when TEST_DATABASE_URL is
// not set. It wipes the public schema (see wipeTestDatabase).
const url = TEST_DATABASE_URL;
const log = pino({ level: "silent" });

// CHECK constraint → the shared enum it must list, value for value.
const ENUM_CHECKS: Record<string, readonly string[]> = {
  companies_ats_check: ATS_TYPES,
  jobs_source_check: ATS_TYPES,
  jobs_remote_type_check: REMOTE_TYPES,
  jobs_seniority_check: SENIORITY_LEVELS,
  jobs_salary_period_check: SALARY_PERIODS,
  job_chunks_section_check: JOB_CHUNK_SECTIONS,
  resume_chunks_section_check: RESUME_SECTIONS,
  applications_status_check: APPLICATION_STATUSES,
  application_events_from_status_check: APPLICATION_STATUSES,
  application_events_to_status_check: APPLICATION_STATUSES,
  llm_calls_tier_check: LLM_TIERS,
  profile_seniority_check: SENIORITY_LEVELS,
  profile_remote_types_check: REMOTE_TYPES,
};

describe.skipIf(!url)("migrations against Postgres", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await wipeTestDatabase(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it("applies every migration to an empty database, then has nothing left to do", async () => {
    const files = await loadMigrationFiles(MIGRATIONS_DIR);

    const first = await runMigrations(client, files, log);
    const second = await runMigrations(client, files, log);

    expect(first.map((m) => m.version)).toEqual(files.map((m) => m.version));
    expect(second).toEqual([]);
  });

  it("creates every table", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "application_events",
      "applications",
      "companies",
      "fetch_runs",
      "job_chunks",
      "jobs",
      "llm_calls",
      "matches",
      "profile",
      "resume_chunks",
      "resume_versions",
      "schema_migrations",
    ]);
  });

  it.each(Object.entries(ENUM_CHECKS))("%s lists exactly the shared enum values", async (constraint, expected) => {
    const { rows } = await client.query<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1", [
      constraint,
    ]);
    const values = [...(rows[0]?.def ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(values.sort()).toEqual([...expected].sort());
  });

  it("keeps a single current match per job", async () => {
    await client.query(`
      INSERT INTO companies (id, name, ats, ats_key, careers_url) VALUES ('acme', 'Acme', 'greenhouse', 'acme', 'https://example.com');
      INSERT INTO jobs (id, company_id, source, external_id, url, url_normalized, fingerprint, title, description, description_hash)
        VALUES ('gh:acme:1', 'acme', 'greenhouse', '1', 'https://example.com/1', 'example.com/1', 'f', 'Engineer', 'text', 'h');
      INSERT INTO resume_versions (label, content, content_hash) VALUES ('v1', 'resume', 'rh');
      INSERT INTO matches (job_id, resume_version_id, hard_filter_result) VALUES ('gh:acme:1', 1, '{"passed": true, "failed": []}');`);

    await expect(
      client.query(`INSERT INTO matches (job_id, resume_version_id, hard_filter_result) VALUES ('gh:acme:1', 1, '{"passed": true, "failed": []}')`),
    ).rejects.toThrow(/matches_one_current_per_job_idx/);
    await expect(
      client.query(`INSERT INTO matches (job_id, resume_version_id, is_current, final_score, hard_filter_result)
                    VALUES ('gh:acme:1', 1, false, 80, '{"passed": false, "failed": []}')`),
    ).rejects.toThrow(/matches_filtered_not_scored_check/);
  });
});
