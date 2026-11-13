import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type pg from "pg";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HARD_FILTER_CONFIG as config } from "../../config/scoring.ts";
import type { CompanyConfig } from "../config/companies.ts";
import { syncCompanies } from "../db/companies-repo.ts";
import { closeStaleJobs, upsertJobs } from "../db/jobs-repo.ts";
import { getProfile, saveProfile } from "../db/profile-repo.ts";
import { getActiveResumeVersionId, saveResumeVersion } from "../db/resume-repo.ts";
import { createMigratedTestPool, TEST_DATABASE_URL } from "../db/test-db.ts";
import type { RawJob } from "../fetchers/types.ts";
import { importResume } from "../resume/import.ts";
import { runDedupeFilterStage } from "./dedupe-filter-stage.ts";
import { FilterPrerequisiteError, filterJob } from "./filter-job.ts";
import { normalizeJob } from "./normalize.ts";
import { testProfile } from "./test-fixtures.ts";

// Stage [2] end-to-end through Postgres. No network, no LLM.
const log = pino({ level: "silent" });

const companyConfig = (id: string, ats: CompanyConfig["ats"] = "greenhouse"): CompanyConfig => ({
  id,
  name: id,
  ats,
  atsKey: id,
  atsConfig: {},
  careersUrl: "https://example.com/careers",
  enabled: ats !== "manual",
  tier: 2,
});

const raw = (externalId: string, overrides: Partial<RawJob> = {}): RawJob => ({
  externalId,
  url: `https://example.com/jobs/${externalId}`,
  title: "Backend Engineer",
  location: "Bengaluru",
  remoteType: null,
  description: "Build services. 3+ years of experience with Node.js.",
  postedAt: null,
  salary: null,
  ...overrides,
});

describe.skipIf(!TEST_DATABASE_URL)("stage [2] against Postgres", () => {
  let db: pg.Pool;

  /** Stores jobs for a company and returns their ids. */
  async function addJobs(company: CompanyConfig, jobs: RawJob[]): Promise<string[]> {
    const [row] = (await syncCompanies(db, [company])).filter((c) => c.id === company.id);
    // A manual company is disabled, so syncCompanies does not return it: read it back.
    const stored = row ?? { ...company, createdAt: new Date(), updatedAt: new Date() };
    const normalized = jobs.map((job) => normalizeJob(job, stored));
    await upsertJobs(db, normalized);
    return normalized.map((job) => job.id);
  }

  async function ready(): Promise<void> {
    const { updatedAt: _ignored, ...profile } = testProfile();
    await saveProfile(db, profile);
    await saveResumeVersion(db, { label: "v1", sourcePath: "main.tex", content: "resume", contentHash: "hash-1", chunks: [] });
  }

  const currentMatch = async (jobId: string) =>
    (await db.query("SELECT hard_filter_result AS result, final_score FROM matches WHERE job_id = $1 AND is_current", [jobId])).rows[0];

  beforeAll(async () => {
    db = await createMigratedTestPool();
  });
  beforeEach(async () => {
    await db.query(
      "TRUNCATE application_events, applications, matches, job_chunks, jobs, fetch_runs, resume_chunks, resume_versions, companies, profile RESTART IDENTITY CASCADE",
    );
  });
  afterAll(async () => {
    await db.end();
  });

  it("refuses to filter until the profile and the resume are imported", async () => {
    const [jobId] = await addJobs(companyConfig("acme"), [raw("1")]);

    await expect(filterJob(db, jobId!, config)).rejects.toThrow(FilterPrerequisiteError);
    const { updatedAt: _ignored, ...profile } = testProfile();
    await saveProfile(db, profile);
    await expect(filterJob(db, jobId!, config)).rejects.toThrow(/resume:import/);
  });

  it("filters new jobs, saves what it read from each posting and records why a job failed", async () => {
    await ready();
    const [good, senior, noida] = await addJobs(companyConfig("acme"), [
      raw("1"),
      raw("2", { title: "Staff Backend Engineer", description: "10+ years of backend experience." }),
      raw("3", { location: "Noida, Uttar Pradesh" }),
    ]);

    const summary = await runDedupeFilterStage({ db, log, config });

    expect(summary).toEqual({ closed: 0, duplicates: 0, reposts: 0, passed: 1, failed: 2, failedByRule: { seniority: 1, years: 1, location: 1 } });
    expect((await currentMatch(good!)).result).toEqual({ passed: true, enforced: true, failed: [], unknown: ["seniority", "salary"] });
    expect((await currentMatch(senior!)).result.failed).toEqual([
      { rule: "seniority", detail: "staff-level role; I target mid, senior" },
      { rule: "years", detail: "asks for 10+ years; I have 5" },
    ]);
    expect((await currentMatch(noida!)).result.failed[0].rule).toBe("location");

    const { rows } = await db.query("SELECT external_id, seniority, years_min FROM jobs ORDER BY external_id");
    expect(rows).toEqual([
      { external_id: "1", seniority: null, years_min: 3 },
      { external_id: "2", seniority: "staff", years_min: 10 },
      { external_id: "3", seniority: null, years_min: 3 },
    ]);
  });

  it("does nothing on a second run", async () => {
    await ready();
    await addJobs(companyConfig("acme"), [raw("1"), raw("2", { title: "Full Stack Developer" })]);

    await runDedupeFilterStage({ db, log, config });
    const second = await runDedupeFilterStage({ db, log, config });

    expect(second).toMatchObject({ passed: 0, failed: 0, duplicates: 0 });
    expect((await db.query("SELECT count(*)::int AS n FROM matches")).rows[0].n).toBe(2);
  });

  it("links an identical posting to the original and filters only the original", async () => {
    await ready();
    const [original, copy, otherTeam] = await addJobs(companyConfig("acme"), [
      raw("1"),
      raw("2"),
      raw("3", { description: "A different team. 3+ years of experience." }),
    ]);
    await db.query("UPDATE jobs SET first_seen = '2026-11-01' WHERE id = $1", [original]);

    const summary = await runDedupeFilterStage({ db, log, config });

    expect(summary).toMatchObject({ duplicates: 1, passed: 2 });
    const { rows } = await db.query("SELECT id, duplicate_of FROM jobs ORDER BY external_id");
    expect(rows).toEqual([
      { id: original, duplicate_of: null },
      { id: copy, duplicate_of: original },
      { id: otherTeam, duplicate_of: null }, // same title, different text: a different opening
    ]);
    expect(await currentMatch(copy!)).toBeUndefined();
  });

  it("flags a repost of a posting that was closed earlier", async () => {
    await ready();
    const [old] = await addJobs(companyConfig("acme"), [raw("1")]);
    await db.query("UPDATE jobs SET first_seen = '2026-10-01', closed_at = '2026-10-20' WHERE id = $1", [old]);
    const [again] = await addJobs(companyConfig("acme"), [raw("2")]);

    const summary = await runDedupeFilterStage({ db, log, config });

    expect(summary).toMatchObject({ reposts: 1, duplicates: 0, passed: 1 });
    expect((await db.query("SELECT repost_of FROM jobs WHERE id = $1", [again])).rows[0].repost_of).toBe(old);
  });

  it("annotates a manual job instead of blocking it, and lets it be scored", async () => {
    await ready();
    const [normal] = await addJobs(companyConfig("acme"), [raw("1", { location: "Noida" })]);
    const [manual] = await addJobs(companyConfig("recruiter-dm", "manual"), [raw("2", { location: "Noida" })]);

    await runDedupeFilterStage({ db, log, config });

    expect((await currentMatch(manual!)).result).toMatchObject({ passed: false, enforced: false });
    await db.query("UPDATE matches SET final_score = 82 WHERE job_id = $1", [manual]);
    // The same update on an enforced failure breaks the table's rule.
    await expect(db.query("UPDATE matches SET final_score = 82 WHERE job_id = $1", [normal])).rejects.toThrow(/matches_filtered_not_scored_check/);
  });

  it("leaves a job that already has a score alone", async () => {
    await ready();
    const [jobId] = await addJobs(companyConfig("acme"), [raw("1")]);
    await filterJob(db, jobId!, config);
    await db.query("UPDATE matches SET final_score = 75 WHERE job_id = $1", [jobId]);

    await expect(filterJob(db, jobId!, config)).resolves.toEqual({ status: "skipped", reason: "already scored" });
    expect((await db.query("SELECT count(*)::int AS n FROM matches")).rows[0].n).toBe(1);
  });

  it("keeps history when a job is filtered again", async () => {
    await ready();
    const [jobId] = await addJobs(companyConfig("acme"), [raw("1", { location: "Noida" })]);
    await filterJob(db, jobId!, config);
    const { updatedAt: _ignored, ...profile } = testProfile({ locations: ["Noida"] });
    await saveProfile(db, profile);

    await filterJob(db, jobId!, config);

    const { rows } = await db.query("SELECT is_current, (hard_filter_result->>'passed')::boolean AS passed FROM matches ORDER BY id");
    expect(rows).toEqual([
      { is_current: false, passed: false },
      { is_current: true, passed: true },
    ]);
  });

  describe("closing stale jobs", () => {
    const run = (company: string, startedAt: string, error: string | null = null) =>
      db.query("INSERT INTO fetch_runs (company_id, started_at, finished_at, error) VALUES ($1, $2, $2, $3)", [company, startedAt, error]);

    it("closes a job missing from the last two successful runs, and counts it on the latest run", async () => {
      await addJobs(companyConfig("acme"), [raw("gone"), raw("seen-once"), raw("still-here")]);
      await db.query("UPDATE jobs SET last_seen = '2026-11-01 00:05' WHERE external_id = 'gone'");
      await db.query("UPDATE jobs SET last_seen = '2026-11-03 00:05' WHERE external_id = 'seen-once'");
      await db.query("UPDATE jobs SET last_seen = '2026-11-05 00:05' WHERE external_id = 'still-here'");
      await run("acme", "2026-11-01");
      await run("acme", "2026-11-03");
      await run("acme", "2026-11-05");

      await expect(closeStaleJobs(db, "acme", 2)).resolves.toBe(1);

      const jobs = await db.query("SELECT external_id, closed_at IS NOT NULL AS closed FROM jobs ORDER BY external_id");
      expect(jobs.rows).toEqual([
        { external_id: "gone", closed: true },
        { external_id: "seen-once", closed: false }, // missed one run only
        { external_id: "still-here", closed: false },
      ]);
      const runs = await db.query("SELECT jobs_closed FROM fetch_runs ORDER BY started_at");
      expect(runs.rows.map((r) => r.jobs_closed)).toEqual([0, 0, 1]);
      await expect(closeStaleJobs(db, "acme", 2)).resolves.toBe(0); // running again changes nothing
    });

    it("ignores failed runs, so an outage closes nothing", async () => {
      await addJobs(companyConfig("acme"), [raw("1")]);
      await db.query("UPDATE jobs SET last_seen = '2026-11-01 00:05'");
      await run("acme", "2026-11-01");
      await run("acme", "2026-11-03", "HTTP 503");
      await run("acme", "2026-11-05", "HTTP 503");

      await expect(closeStaleJobs(db, "acme", 2)).resolves.toBe(0);
    });

    it("lets a copy stand on its own once its original is closed", async () => {
      await ready();
      const [original, copy] = await addJobs(companyConfig("acme"), [raw("1"), raw("2")]);
      await db.query("UPDATE jobs SET first_seen = '2026-11-01' WHERE id = $1", [original]);
      await runDedupeFilterStage({ db, log, config });
      await db.query("UPDATE jobs SET closed_at = now() WHERE id = $1", [original]);

      const summary = await runDedupeFilterStage({ db, log, config });

      expect(summary).toMatchObject({ duplicates: 0, passed: 1 });
      expect((await db.query("SELECT duplicate_of FROM jobs WHERE id = $1", [copy])).rows[0].duplicate_of).toBeNull();
      expect((await currentMatch(copy!)).result.passed).toBe(true);
    });
  });

  describe("profile and resume storage", () => {
    it("round-trips the profile, including the decimal years", async () => {
      const { updatedAt: _ignored, ...profile } = testProfile({ experienceYears: 4.8, dealBreakers: ["night shift"] });
      await saveProfile(db, profile);
      await saveProfile(db, profile); // importing twice keeps a single row

      expect(await getProfile(db)).toMatchObject(profile);
      expect((await db.query("SELECT count(*)::int AS n FROM profile")).rows[0].n).toBe(1);
    });

    it("imports a LaTeX resume once, and re-activates an older version instead of duplicating it", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "kira-resume-"));
      const files = { tex: path.join(dir, "main.tex"), pdf: path.join(dir, "resume.pdf") };
      const v1 = String.raw`\begin{document}\section{Summary} Developer. \section{Experience} Acme \begin{itemize}\item Built X.\end{itemize}\end{document}`;
      try {
        await writeFile(files.tex, v1);
        const first = await importResume(db, files);
        const again = await importResume(db, files);
        await writeFile(files.tex, v1.replace("Built X", "Built Y"));
        const second = await importResume(db, files);
        await writeFile(files.tex, v1);
        const back = await importResume(db, files);

        expect([first.outcome, again.outcome, second.outcome, back.outcome]).toEqual(["created", "unchanged", "created", "reactivated"]);
        expect(first.chunks.map((c) => c.section)).toEqual(["summary", "experience"]);
        expect(await getActiveResumeVersionId(db)).toBe(first.versionId);
        const { rows } = await db.query(
          "SELECT v.id, v.is_active, count(c.id)::int AS chunks, count(c.embedding)::int AS embedded FROM resume_versions v LEFT JOIN resume_chunks c ON c.resume_version_id = v.id GROUP BY v.id ORDER BY v.id",
        );
        expect(rows).toEqual([
          { id: first.versionId, is_active: true, chunks: 2, embedded: 0 },
          { id: second.versionId, is_active: false, chunks: 2, embedded: 0 },
        ]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("says where to put the resume when there is none", async () => {
      await expect(importResume(db, { tex: "/nonexistent/main.tex", pdf: "/nonexistent/resume.pdf" })).rejects.toThrow(/No resume found/);
    });
  });
});
