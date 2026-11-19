import type { JobChunkSection, ResumeSection } from "@kira/shared";
import type pg from "pg";
import {
  bestResumeMatches,
  embeddedJobSections,
  nearestResumeChunks,
  normalizeCurrentSimilarities,
  setCurrentMatchSimilarity,
  type ChunkMatchRow,
} from "../db/chunks-repo.ts";

// Retrieval: for a piece of a job description, find the resume chunks whose
// vectors point the same way. That is the "R" in RAG: the scoring step gives
// the LLM these chunks as evidence instead of the whole resume.

const BASIS_ORDER: readonly JobChunkSection[] = ["requirements", "responsibilities", "other"];

export interface JobSimilarity {
  similarity: number; // 0–1
  basis: JobChunkSection; // which part of the posting it was computed from
  pairs: ChunkMatchRow[]; // each job chunk with its closest resume chunk
  written: boolean; // false when there is no unscored current match to write to
}

/** Length-weighted average of each chunk's best cosine, clamped to 0–1. */
export function weightedSimilarity(pairs: readonly Pick<ChunkMatchRow, "weight" | "cosine">[]): number {
  const totalWeight = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  if (totalWeight === 0) return 0;
  const value = pairs.reduce((sum, pair) => sum + pair.cosine * pair.weight, 0) / totalWeight;
  return Math.min(1, Math.max(0, value));
}

/**
 * Per-job: how well the job's requirements (or, failing that, its
 * responsibilities or other text) match the resume, written to the job's
 * current match. Null when the job or the resume has no vectors yet.
 */
export async function similarityForJob(db: pg.Pool, jobId: string): Promise<JobSimilarity | null> {
  const sections = await embeddedJobSections(db, jobId);
  const basis = BASIS_ORDER.find((section) => sections.has(section));
  if (!basis) return null;

  const pairs = await bestResumeMatches(db, jobId, basis);
  if (pairs.length === 0) return null; // the resume has no vectors

  const similarity = weightedSimilarity(pairs);
  const written = await setCurrentMatchSimilarity(db, jobId, similarity);
  return { similarity, basis, pairs, written };
}

export function retrieveResumeChunks(
  db: pg.Pool,
  jobChunkId: number,
  k: number,
): Promise<{ id: number; section: ResumeSection; content: string; cosine: number }[]> {
  return nearestResumeChunks(db, jobChunkId, k);
}

export function normalizeSimilarities(db: pg.Pool) {
  return normalizeCurrentSimilarities(db);
}
