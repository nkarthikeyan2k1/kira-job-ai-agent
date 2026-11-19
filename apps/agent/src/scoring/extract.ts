import type { JobChunkSection, RequirementResult } from "@kira/shared";
import type pg from "pg";
import type { ScoringConfig } from "../../config/scoring.ts";
import { CONTACT } from "../ai/embed.ts";
import type { LlmClient } from "../ai/llm-client.ts";
import { buildExtractionPrompt, EXTRACTION_JSON_SCHEMA, ExtractionSchema, PROMPT_VERSION } from "../ai/prompts/extract-requirements.ts";
import { retrieveResumeChunks } from "../ai/retrieve.ts";
import { getJobChunks } from "../db/chunks-repo.ts";
import { getJob } from "../db/jobs-repo.ts";
import { getActiveResume } from "../db/resume-repo.ts";
import { verifyRequirements, type VerifyStats } from "./verify.ts";

export interface Extraction {
  breakdown: RequirementResult[]; // verified
  stats: VerifyStats;
  basis: JobChunkSection | "description";
  model: string;
  promptVersion: string;
  resumeVersionId: number;
}

const BASIS_ORDER: readonly JobChunkSection[] = ["requirements", "responsibilities", "other"];

/**
 * Stage [4] for one job: asks the local model which of the job's requirements
 * the resume meets, with quotes, then checks the answer in code (verify.ts).
 *
 * The job text is its requirements chunks (else responsibilities, else other;
 * the raw description when the job was never chunked). The resume context is
 * the whole resume ("full") or, with "retrieved", only the resume chunks
 * closest to each requirements chunk: the retrieval step of RAG.
 */
export async function extractRequirements(
  db: pg.Pool,
  llm: LlmClient,
  jobId: string,
  config: ScoringConfig,
  onCut?: (chars: number) => void,
): Promise<Extraction> {
  const [job, resume, chunks] = await Promise.all([getJob(db, jobId), getActiveResume(db), getJobChunks(db, jobId)]);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (!resume) throw new Error("No active resume: run `npm run resume:import`");

  const basis = BASIS_ORDER.find((section) => chunks.some((chunk) => chunk.section === section));
  const basisChunks = basis ? chunks.filter((chunk) => chunk.section === basis) : [];
  let jobText = basisChunks.length > 0 ? basisChunks.map((chunk) => chunk.content).join("\n\n") : job.description;
  if (jobText.length > config.maxJobChars) {
    onCut?.(jobText.length);
    jobText = jobText.slice(0, config.maxJobChars);
  }

  let context = resume.chunks.filter((chunk) => !(chunk.section === "other" && CONTACT.test(chunk.content)));
  if (config.resumeContext === "retrieved") {
    const ids = new Set<number>();
    for (const chunk of basisChunks.filter((c) => c.embedded)) {
      for (const hit of await retrieveResumeChunks(db, chunk.id, config.retrieveK)) ids.add(hit.id);
    }
    if (ids.size > 0) context = context.filter((chunk) => ids.has(chunk.id));
  }

  const { system, user } = buildExtractionPrompt(jobText, context);
  const { value, model } = await llm.generateJson("score.extract_requirements", {
    system,
    user,
    schema: ExtractionSchema,
    jsonSchema: EXTRACTION_JSON_SCHEMA,
    promptVersion: PROMPT_VERSION,
    jobId,
  });

  const { results, stats } = verifyRequirements(value.requirements, resume.content);
  return { breakdown: results, stats, basis: basis ?? "description", model, promptVersion: PROMPT_VERSION, resumeVersionId: resume.id };
}
