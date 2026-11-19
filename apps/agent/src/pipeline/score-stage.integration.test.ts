import type { RequirementResult } from "@kira/shared";
import type pg from "pg";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CHUNK_CONFIG, HARD_FILTER_CONFIG, SCORING_CONFIG, SIMILARITY_CONFIG } from "../../config/scoring.ts";
import { fakeLlmClient } from "../ai/fake-embedder.ts";
import { ModelOutputError, ModelUnavailableError, type LlmClient } from "../ai/llm-client.ts";
import { PROMPT_VERSION } from "../ai/prompts/extract-requirements.ts";
import type { CompanyConfig } from "../config/companies.ts";
import { syncCompanies } from "../db/companies-repo.ts";
import { upsertJobs } from "../db/jobs-repo.ts";
import { saveProfile } from "../db/profile-repo.ts";
import { saveResumeVersion } from "../db/resume-repo.ts";
import { createMigratedTestPool, TEST_DATABASE_URL } from "../db/test-db.ts";
import type { RawJob } from "../fetchers/types.ts";
import { scoreJob } from "../scoring/score-job.ts";
import { runDedupeFilterStage } from "./dedupe-filter-stage.ts";
import { runEmbedStage } from "./embed-stage.ts";
import { normalizeJob } from "./normalize.ts";
import { runScoreStage } from "./score-stage.ts";
import { testProfile } from "./test-fixtures.ts";

// Stages [4] + [5] through Postgres with a fake model: no Ollama.
const log = pino({ level: "silent" });
const QUOTE = "Built payment ledger services in Node.js and PostgreSQL.";
const RESUME_TEXT = `Asha Rao\n# Experience\nAcme Payments\n- ${QUOTE}\n# Skills\nNode.js, TypeScript, PostgreSQL`;

const company = (id: string, ats: CompanyConfig["ats"] = "greenhouse"): CompanyConfig => ({
  id, name: id, ats, atsKey: id, atsConfig: {}, careersUrl: "https://example.com/careers", enabled: ats !== "manual", tier: 2,
});
const raw = (externalId: string, requirements: string, location = "Pune"): RawJob => ({
  externalId, url: `https://example.com/jobs/${externalId}`, title: "Backend Engineer", location, remoteType: null,
  description: `About us\nWe move money for merchants every single day across India.\n\nRequirements\n${requirements}`,
  postedAt: null, salary: null,
});

/** A fake model whose answer depends on what the posting asks for, so tests can steer the score. */
function fakeModel(overrides: Partial<LlmClient> = {}): LlmClient & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    ...fakeLlmClient(),
    prompts,
    async generateJson(_task, request) {
      prompts.push(request.user);
      const requirements: RequirementResult[] = [
        { requirement: "Node.js and PostgreSQL", weight: "must", status: "met", evidence: QUOTE },
        // A quote the resume does not contain: verification must drop it and downgrade to partial.
        { requirement: "Kafka", weight: "must", status: "met", evidence: "Ran Kafka clusters at scale" },
      ];
      if (request.user.includes("Java")) requirements.push({ requirement: "Java and Spring Boot", weight: "must", status: "missing", evidence: null });
      if (request.user.includes("AWS")) requirements.push({ requirement: "AWS is a plus", weight: "must", status: "missing", evidence: null });
      return { value: request.schema.parse({ requirements }), model: "fake-model" };
    },
    ...overrides,
  };
}

describe.skipIf(!TEST_DATABASE_URL)("stages [4] + [5] against Postgres", () => {
  let db: pg.Pool;

  async function addJobs(config: CompanyConfig, jobs: RawJob[]): Promise<string[]> {
    const [row] = (await syncCompanies(db, [config])).filter((c) => c.id === config.id);
    const stored = row ?? { ...config, createdAt: new Date(), updatedAt: new Date() };
    const normalized = jobs.map((job) => normalizeJob(job, stored));
    await upsertJobs(db, normalized);
    return normalized.map((job) => job.id);
  }

  /** Profile, resume, jobs, then stages [2] and [3] with fakes. */
  async function prepare(jobs: RawJob[], extra: { manual?: RawJob[] } = {}): Promise<{ ids: string[]; manualIds: string[] }> {
    const { updatedAt: _ignored, ...profile } = testProfile();
    await saveProfile(db, profile);
    await saveResumeVersion(db, {
      label: "v1", sourcePath: "main.tex", content: RESUME_TEXT, contentHash: "h1",
      chunks: [
        { section: "experience", ordinal: 0, content: `Acme Payments\n- ${QUOTE}` },
        { section: "skills", ordinal: 0, content: "Node.js, TypeScript, PostgreSQL" },
      ],
    });
    const ids = await addJobs(company("acme"), jobs);
    const manualIds = extra.manual ? await addJobs(company("dm", "manual"), extra.manual) : [];
    await runDedupeFilterStage({ db, log, config: HARD_FILTER_CONFIG });
    await runEmbedStage({ db, log, llm: fakeLlmClient(), settings: { tag: "t/1", chunk: CHUNK_CONFIG, embedSections: SIMILARITY_CONFIG.embedSections } });
    return { ids, manualIds };
  }

  const matchesOf = async (jobId: string) =>
    (await db.query("SELECT is_current, final_score, llm_score, similarity_norm, prompt_version, model, breakdown, reason FROM matches WHERE job_id = $1 ORDER BY id", [jobId])).rows;
  const applicationOf = async (jobId: string) =>
    (await db.query("SELECT a.status, e.to_status, e.note FROM applications a LEFT JOIN application_events e ON e.application_id = a.id WHERE a.job_id = $1", [jobId])).rows;

  beforeAll(async () => {
    db = await createMigratedTestPool();
  });
  beforeEach(async () => {
    await db.query("TRUNCATE llm_calls, application_events, applications, matches, job_chunks, jobs, fetch_runs, resume_chunks, resume_versions, companies, profile RESTART IDENTITY CASCADE");
  });
  afterAll(async () => {
    await db.end();
  });

  it("scores a passing job, verifies the model's quotes and keeps the filter row as history", async () => {
    const { ids: [jobId] } = await prepare([raw("1", "- Node.js and PostgreSQL for payment services.")]);
    const model = fakeModel();

    const outcome = await scoreJob(db, model, jobId!, SCORING_CONFIG);

    expect(outcome).toMatchObject({ status: "scored", llmScore: 75, finalScore: 85 }); // 1 met + 1 partial of 2 musts; norm 1 (single job)
    const rows = await matchesOf(jobId!);
    expect(rows.map((r) => r.is_current)).toEqual([false, true]);
    expect(rows[1]).toMatchObject({ final_score: 85, llm_score: 75, prompt_version: PROMPT_VERSION, model: "fake-model" });
    expect(rows[1].breakdown).toEqual([
      { requirement: "Node.js and PostgreSQL", weight: "must", status: "met", evidence: QUOTE },
      { requirement: "Kafka", weight: "must", status: "partial", evidence: null }, // invented quote dropped
    ]);
    expect(rows[1].reason).toBe("Meets 1 of 2 must-haves (1 partly).");
    expect(model.prompts[0]).toContain("<JOB>\nRequirements\n- Node.js and PostgreSQL");
    expect(model.prompts[0]).not.toContain("We move money"); // only the requirements section is sent
  });

  it("shortlists a job at the threshold, once, with an application event", async () => {
    const { ids: [jobId] } = await prepare([raw("1", "- Node.js and PostgreSQL for payment services.")]);

    await scoreJob(db, fakeModel(), jobId!, SCORING_CONFIG);
    await scoreJob(db, fakeModel(), jobId!, SCORING_CONFIG, { force: true }); // re-scoring never duplicates the application

    expect(await applicationOf(jobId!)).toEqual([{ status: "shortlisted", to_status: "shortlisted", note: "automatic: final score 85" }]);
    expect((await matchesOf(jobId!)).map((r) => r.is_current)).toEqual([false, false, true]);
  });

  it("does not shortlist below the threshold", async () => {
    const { ids: [jobId] } = await prepare([raw("1", "- Java and Spring Boot, AWS, Node.js and PostgreSQL.")]);

    const outcome = await scoreJob(db, fakeModel(), jobId!, { ...SCORING_CONFIG, shortlistThreshold: 90 });

    // musts: met, partial, missing (Java); "AWS is a plus" re-weighted to nice and missing → (2+1+0+0)/(2+2+2+1)
    expect(outcome).toMatchObject({ status: "scored", llmScore: 43 });
    expect(await applicationOf(jobId!)).toEqual([]);
  });

  it("skips jobs that failed the hard filters, have no match yet, or are already scored", async () => {
    const { ids: [inNoida, inPune] } = await prepare([raw("1", "- Node.js.", "Noida"), raw("2", "- Node.js and PostgreSQL.")]);

    await expect(scoreJob(db, fakeModel(), inNoida!, SCORING_CONFIG)).resolves.toEqual({ status: "skipped", reason: "failed hard filters" });
    await scoreJob(db, fakeModel(), inPune!, SCORING_CONFIG);
    await expect(scoreJob(db, fakeModel(), inPune!, SCORING_CONFIG)).resolves.toEqual({ status: "skipped", reason: "already scored" });
    const [unfiltered] = await addJobs(company("acme"), [raw("3", "- Node.js")]);
    await expect(scoreJob(db, fakeModel(), unfiltered!, SCORING_CONFIG)).resolves.toEqual({ status: "skipped", reason: "not filtered yet" });
  });

  it("scores a manual job even though it failed a filter", async () => {
    const { manualIds: [manual] } = await prepare([], { manual: [raw("dm-1", "- Node.js and PostgreSQL.", "Noida")] });

    const outcome = await scoreJob(db, fakeModel(), manual!, SCORING_CONFIG);

    expect(outcome.status).toBe("scored");
    expect((await matchesOf(manual!)).at(-1).final_score).not.toBeNull();
  });

  it("runs the stage over the most similar passing jobs only, manual jobs always", async () => {
    const { ids, manualIds } = await prepare(
      [raw("1", "- Node.js and PostgreSQL payment ledger services."), raw("2", "- Figma and illustration."), raw("3", "- Node.js.", "Noida")],
      { manual: [raw("dm-1", "- Node.js.", "Noida")] },
    );

    const summary = await runScoreStage({ db, log, llm: fakeModel(), config: SCORING_CONFIG, topN: 1 });

    expect(summary).toMatchObject({ deferred: false, candidates: 2, scored: 2, failed: 0 });
    const { rows } = await db.query("SELECT job_id FROM matches WHERE is_current AND final_score IS NOT NULL ORDER BY job_id");
    expect(rows.map((r) => r.job_id).sort()).toEqual([ids[0], manualIds[0]].sort()); // the Figma job ranked lower; Noida failed
  });

  it("stops and defers when Ollama is down, and skips a job whose answer is unusable", async () => {
    const { ids } = await prepare([raw("1", "- Node.js and PostgreSQL."), raw("2", "- Node.js, PostgreSQL and TypeScript.")]);
    const down = fakeModel({ generateJson: async () => { throw new ModelUnavailableError("Ollama unreachable"); } });

    expect(await runScoreStage({ db, log, llm: down, config: SCORING_CONFIG, topN: 30 })).toMatchObject({ deferred: true, scored: 0 });

    const good = fakeModel();
    let calls = 0;
    const flaky = fakeModel({
      generateJson: async (task, request) => {
        if (calls++ === 0) throw new ModelOutputError("Answer is not valid JSON");
        return good.generateJson(task, request);
      },
    });
    expect(await runScoreStage({ db, log, llm: flaky, config: SCORING_CONFIG, topN: 30 })).toMatchObject({ deferred: false, scored: 1, failed: 1 });
    expect(ids).toHaveLength(2);
  });
});
