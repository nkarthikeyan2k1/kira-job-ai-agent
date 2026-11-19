import type pg from "pg";
import type { EmbedTask } from "../../config/llm-routing.ts";
import type { ChunkConfig } from "../../config/scoring.ts";
import { listResumeChunksToEmbed, replaceJobChunks, setResumeChunkEmbedding, type StoredJobChunk } from "../db/chunks-repo.ts";
import { getJob } from "../db/jobs-repo.ts";
import { chunkJobDescription } from "./chunk.ts";
import type { LlmClient } from "./llm-client.ts";

export interface EmbedSettings {
  tag: string; // EMBEDDING.tag
  chunk: ChunkConfig;
  embedSections: readonly string[];
}

const JOB_TASK: EmbedTask = "embed.job_chunk";
const RESUME_TASK: EmbedTask = "embed.resume_chunk";

// Contact details: personal data with no skills in them, so never embedded
// and never sent to a model.
export const CONTACT = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s-]{8,}\d/;

/**
 * Per-job: chunk the description, embed the chunks that describe the work
 * (requirements, responsibilities; "other" when the posting has neither) and
 * store everything. Used by stage [3] and, later, by manual mode for one job.
 */
export async function embedJob(
  db: pg.Pool,
  llm: LlmClient,
  jobId: string,
  settings: EmbedSettings,
  onCut?: (chars: number) => void,
): Promise<{ chunks: number; embedded: number }> {
  const job = await getJob(db, jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const drafts = chunkJobDescription(job.description, settings.chunk, onCut);
  const preferred = drafts.filter((draft) => settings.embedSections.includes(draft.section));
  const toEmbed = preferred.length > 0 ? preferred : drafts.filter((draft) => draft.section === "other");

  const vectors = await llm.embed(JOB_TASK, toEmbed.map((draft) => draft.content), { jobId });
  const byDraft = new Map(toEmbed.map((draft, i) => [draft, vectors[i]!]));
  const stored: StoredJobChunk[] = drafts.map((draft) => ({ ...draft, embedding: byDraft.get(draft) ?? null }));

  await replaceJobChunks(db, jobId, stored, settings.tag);
  return { chunks: stored.length, embedded: toEmbed.length };
}

/** Embeds the active resume's chunks that are missing a vector for the current setup. */
export async function embedResume(db: pg.Pool, llm: LlmClient, tag: string): Promise<{ embedded: number; skipped: number }> {
  const pending = await listResumeChunksToEmbed(db, tag);
  const chunks = pending.filter((chunk) => !(chunk.section === "other" && CONTACT.test(chunk.content)));
  const vectors = await llm.embed(RESUME_TASK, chunks.map((chunk) => chunk.content));
  for (const [i, chunk] of chunks.entries()) await setResumeChunkEmbedding(db, chunk.id, vectors[i]!, tag);
  return { embedded: chunks.length, skipped: pending.length - chunks.length };
}
