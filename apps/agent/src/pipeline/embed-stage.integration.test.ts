import type pg from "pg";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CHUNK_CONFIG, HARD_FILTER_CONFIG, SIMILARITY_CONFIG } from "../../config/scoring.ts";
import { embedJob, embedResume, type EmbedSettings } from "../ai/embed.ts";
import { fakeLlmClient } from "../ai/fake-embedder.ts";
import { ModelInputError, ModelUnavailableError, type LlmClient } from "../ai/llm-client.ts";
import { normalizeSimilarities, retrieveResumeChunks, similarityForJob } from "../ai/retrieve.ts";
import type { CompanyConfig } from "../config/companies.ts";
import { listJobsToEmbed } from "../db/chunks-repo.ts";
import { syncCompanies } from "../db/companies-repo.ts";
import { upsertJobs } from "../db/jobs-repo.ts";
import { saveProfile } from "../db/profile-repo.ts";
import { saveResumeVersion } from "../db/resume-repo.ts";
import { createMigratedTestPool, TEST_DATABASE_URL } from "../db/test-db.ts";
import type { RawJob } from "../fetchers/types.ts";
import { runDedupeFilterStage } from "./dedupe-filter-stage.ts";
import { runEmbedStage } from "./embed-stage.ts";
import { normalizeJob } from "./normalize.ts";
import { testProfile } from "./test-fixtures.ts";

// Stage [3] through Postgres + pgvector, with a fake embedder instead of Ollama.
const log = pino({ level: "silent" });
const settings: EmbedSettings = { tag: "test-tag/c1", chunk: CHUNK_CONFIG, embedSections: SIMILARITY_CONFIG.embedSections };

const RESUME_CHUNKS = [
  { section: "other", ordinal: 0, content: "Asha Rao\nPune asha@example.com +91 90000 00000" },
  { section: "skills", ordinal: 0, content: "Backend: Node.js, TypeScript, PostgreSQL, Redis, Kafka" },
  { section: "experience", ordinal: 0, content: "Acme Payments\n- Built payment ledger services in Node.js and PostgreSQL." },
  { section: "projects", ordinal: 0, content: "Mind game\n- Designed a mobile memory game in Figma with React Native." },
] as const;

const BACKEND_JD = `About Acme
Acme moves money for merchants around the world every single day.

Responsibilities
- Build payment ledger services and own their on-call rotation.

Requirements
- Node.js, TypeScript and PostgreSQL for backend payment services.`;

const DESIGN_JD = `Requirements
- Figma, sketching and visual design for mobile games and illustrations.`;

const company = (id: string, ats: CompanyConfig["ats"] = "greenhouse"): CompanyConfig => ({
  id, name: id, ats, atsKey: id, atsConfig: {}, careersUrl: "https://example.com/careers", enabled: ats !== "manual", tier: 2,
});
const raw = (externalId: string, description: string, title = "Backend Engineer"): RawJob => ({
  externalId, url: `https://example.com/jobs/${externalId}`, title, location: "Pune", remoteType: null, description, postedAt: null, salary: null,
});

describe.skipIf(!TEST_DATABASE_URL)("stage [3] against Postgres", () => {
  let db: pg.Pool;

  async function addJobs(config: CompanyConfig, jobs: RawJob[]): Promise<string[]> {
    const [row] = (await syncCompanies(db, [config])).filter((c) => c.id === config.id);
    const stored = row ?? { ...config, createdAt: new Date(), updatedAt: new Date() };
    const normalized = jobs.map((job) => normalizeJob(job, stored));
    await upsertJobs(db, normalized);
    return normalized.map((job) => job.id);
  }

  async function setup(): Promise<{ backend: string; design: string }> {
    const { updatedAt: _ignored, ...profile } = testProfile();
    await saveProfile(db, profile);
    await saveResumeVersion(db, { label: "v1", sourcePath: "main.tex", content: "resume", contentHash: "h1", chunks: RESUME_CHUNKS });
    const [backend, design] = await addJobs(company("acme"), [raw("1", BACKEND_JD), raw("2", DESIGN_JD, "Software Engineer, Games")]);
    await runDedupeFilterStage({ db, log, config: HARD_FILTER_CONFIG }); // creates the current match rows
    return { backend: backend!, design: design! };
  }

  const similarityOf = async (jobId: string) =>
    (await db.query("SELECT similarity, similarity_norm FROM matches WHERE job_id = $1 AND is_current", [jobId])).rows[0];

  beforeAll(async () => {
    db = await createMigratedTestPool();
  });
  beforeEach(async () => {
    await db.query(
      "TRUNCATE llm_calls, application_events, applications, matches, job_chunks, jobs, fetch_runs, resume_chunks, resume_versions, companies, profile RESTART IDENTITY CASCADE",
    );
  });
  afterAll(async () => {
    await db.end();
  });

  it("embeds the resume, skipping the contact chunk", async () => {
    await setup();
    const llm = fakeLlmClient();

    await expect(embedResume(db, llm, settings.tag)).resolves.toEqual({ embedded: 3, skipped: 1 });

    expect(llm.calls[0]!.task).toBe("embed.resume_chunk");
    const { rows } = await db.query("SELECT section, embedding IS NOT NULL AS has_vector, embedding_model FROM resume_chunks ORDER BY id");
    expect(rows).toEqual([
      { section: "other", has_vector: false, embedding_model: null },
      { section: "skills", has_vector: true, embedding_model: "test-tag/c1" },
      { section: "experience", has_vector: true, embedding_model: "test-tag/c1" },
      { section: "projects", has_vector: true, embedding_model: "test-tag/c1" },
    ]);
    await expect(embedResume(db, llm, settings.tag)).resolves.toEqual({ embedded: 0, skipped: 1 }); // already done
  });

  it("stores every chunk of a job but gives vectors only to requirements and responsibilities", async () => {
    const { backend } = await setup();
    const llm = fakeLlmClient();

    await expect(embedJob(db, llm, backend, settings)).resolves.toEqual({ chunks: 3, embedded: 2 });

    const { rows } = await db.query(
      "SELECT section, ordinal, embedding IS NOT NULL AS has_vector, embedding_model FROM job_chunks WHERE job_id = $1 ORDER BY id",
      [backend],
    );
    expect(rows).toEqual([
      { section: "about", ordinal: 0, has_vector: false, embedding_model: null },
      { section: "responsibilities", ordinal: 0, has_vector: true, embedding_model: "test-tag/c1" },
      { section: "requirements", ordinal: 0, has_vector: true, embedding_model: "test-tag/c1" },
    ]);
    expect((await db.query("SELECT embedding_model FROM jobs WHERE id = $1", [backend])).rows[0].embedding_model).toBe("test-tag/c1");
    expect(llm.calls[0]!.texts[1]).toMatch(/^Requirements\n/); // headings stay in the text
  });

  it("embeds a job again only when its description changed", async () => {
    const { backend } = await setup();
    const llm = fakeLlmClient();
    await embedJob(db, llm, backend, settings);
    expect(await listJobsToEmbed(db, settings.tag)).not.toContain(backend);

    await addJobs(company("acme"), [raw("1", BACKEND_JD.replace("Node.js", "Go"))]); // the fetch stage sees a new description

    expect(await listJobsToEmbed(db, settings.tag)).toContain(backend);
    await embedJob(db, llm, backend, settings);
    const { rows } = await db.query("SELECT content FROM job_chunks WHERE job_id = $1 AND section = 'requirements'", [backend]);
    expect(rows).toEqual([{ content: "Requirements\n- Go, TypeScript and PostgreSQL for backend payment services." }]);
  });

  it("ranks the job that shares the resume's skills higher and retrieves the right evidence", async () => {
    const { backend, design } = await setup();
    const llm = fakeLlmClient();
    await embedResume(db, llm, settings.tag);
    await embedJob(db, llm, backend, settings);
    await embedJob(db, llm, design, settings);

    const backendSim = await similarityForJob(db, backend);
    const designSim = await similarityForJob(db, design);

    expect(backendSim).toMatchObject({ basis: "requirements", written: true });
    expect(backendSim!.similarity).toBeGreaterThan(designSim!.similarity);
    const [requirementsChunk] = backendSim!.pairs;
    const evidence = await retrieveResumeChunks(db, requirementsChunk!.jobChunkId, 2);
    expect(evidence.map((e) => e.section)).toEqual(["skills", "experience"]);
    expect(evidence[0]!.cosine).toBeGreaterThan(evidence[1]!.cosine);
    expect(Number((await similarityOf(backend)).similarity)).toBeCloseTo(backendSim!.similarity, 5);
  });

  it("falls back to the responsibilities when a job has no requirements section", async () => {
    await setup();
    const [jobId] = await addJobs(company("acme"), [raw("3", "Responsibilities\n- Build payment ledger services in Node.js every day.")]);
    const llm = fakeLlmClient();
    await embedResume(db, llm, settings.tag);
    await embedJob(db, llm, jobId!, settings);

    expect((await similarityForJob(db, jobId!))?.basis).toBe("responsibilities");
  });

  it("never edits a match that already has a score", async () => {
    const { backend } = await setup();
    const llm = fakeLlmClient();
    await embedResume(db, llm, settings.tag);
    await embedJob(db, llm, backend, settings);
    await db.query("UPDATE matches SET similarity = 0.1, final_score = 80 WHERE job_id = $1", [backend]);

    expect((await similarityForJob(db, backend))?.written).toBe(false);
    expect(Number((await similarityOf(backend)).similarity)).toBeCloseTo(0.1, 5);
  });

  it("runs the whole stage: embeds, scores similarity and rescales it to 0–1", async () => {
    const { backend, design } = await setup();

    const summary = await runEmbedStage({ db, log, llm: fakeLlmClient(), settings });

    expect(summary).toMatchObject({ deferred: false, resumeChunksEmbedded: 3, jobsEmbedded: 2, jobsSkipped: 0, similarities: 2 });
    expect(Number((await similarityOf(backend)).similarity_norm)).toBe(1);
    expect(Number((await similarityOf(design)).similarity_norm)).toBe(0);

    const again = await runEmbedStage({ db, log, llm: fakeLlmClient(), settings });
    expect(again).toMatchObject({ resumeChunksEmbedded: 0, jobsEmbedded: 0, similarities: 2 }); // nothing re-embedded
  });

  it("gives a single job a normalised similarity of 1", async () => {
    const { backend } = await setup();
    await db.query("DELETE FROM matches WHERE job_id <> $1", [backend]);
    const llm = fakeLlmClient();
    await embedResume(db, llm, settings.tag);
    await embedJob(db, llm, backend, settings);
    await similarityForJob(db, backend);

    await expect(normalizeSimilarities(db)).resolves.toMatchObject({ jobs: 1 });
    expect(Number((await similarityOf(backend)).similarity_norm)).toBe(1);
  });

  it("defers the work, without failing, when Ollama is down", async () => {
    await setup();
    const down: LlmClient = {
      ...fakeLlmClient(),
      embed: async () => {
        throw new ModelUnavailableError("Ollama unreachable");
      },
    };

    const summary = await runEmbedStage({ db, log, llm: down, settings });

    expect(summary).toMatchObject({ deferred: true, jobsEmbedded: 0, similarities: 0 });
    expect((await db.query("SELECT count(*)::int AS n FROM job_chunks")).rows[0].n).toBe(0);
  });

  it("skips a job whose input the model refuses and carries on with the rest", async () => {
    const { backend, design } = await setup();
    const fake = fakeLlmClient();
    const picky: LlmClient = {
      ...fake,
      embed: async (task, texts, meta) => {
        if (meta?.jobId === backend) throw new ModelInputError("the input length exceeds the context length");
        return fake.embed(task, texts, meta);
      },
    };

    const summary = await runEmbedStage({ db, log, llm: picky, settings });

    expect(summary).toMatchObject({ jobsEmbedded: 1, jobsSkipped: 1 });
    expect((await db.query("SELECT id FROM jobs WHERE embedding_model IS NOT NULL")).rows).toEqual([{ id: design }]);
  });

  it("treats a manual job like any other", async () => {
    await setup();
    const [manual] = await addJobs(company("recruiter-dm", "manual"), [raw("dm-1", BACKEND_JD)]);
    await runDedupeFilterStage({ db, log, config: HARD_FILTER_CONFIG });

    await runEmbedStage({ db, log, llm: fakeLlmClient(), settings });

    expect((await similarityOf(manual!)).similarity).not.toBeNull();
  });
});
