import type { JobChunkSection, ResumeSection } from "@kira/shared";
import type pg from "pg";
import { toVectorLiteral } from "../ai/vector.ts";

// All SQL that reads or writes vectors. pgvector's `<=>` is cosine distance
// (0 = same direction); similarity is 1 - distance.

export interface StoredJobChunk {
  section: JobChunkSection;
  ordinal: number;
  content: string;
  embedding: number[] | null;
}

/** Open, non-duplicate jobs whose chunks are missing or were made with another embedding setup. Oldest first. */
export async function listJobsToEmbed(db: pg.Pool, tag: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM jobs
      WHERE closed_at IS NULL AND duplicate_of IS NULL AND embedding_model IS DISTINCT FROM $1
      ORDER BY first_seen, id`,
    [tag],
  );
  return rows.map((row) => row.id);
}

/** Open, non-duplicate jobs that have chunks made with the current setup. */
export async function listEmbeddedJobIds(db: pg.Pool, tag: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM jobs WHERE closed_at IS NULL AND duplicate_of IS NULL AND embedding_model = $1 ORDER BY first_seen, id",
    [tag],
  );
  return rows.map((row) => row.id);
}

/**
 * Replaces a job's chunks in one transaction and marks the job as embedded
 * with `tag`. Chunks without a vector (about, benefits) are stored as text only.
 */
export async function replaceJobChunks(db: pg.Pool, jobId: string, chunks: readonly StoredJobChunk[], tag: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM job_chunks WHERE job_id = $1", [jobId]);
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO job_chunks (job_id, section, ordinal, content, embedding, embedding_model)
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [
          jobId,
          chunk.section,
          chunk.ordinal,
          chunk.content,
          chunk.embedding ? toVectorLiteral(chunk.embedding) : null,
          chunk.embedding ? tag : null,
        ],
      );
    }
    await client.query("UPDATE jobs SET embedding_model = $2 WHERE id = $1", [jobId, tag]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Active-resume chunks that still need a vector for the current setup. */
export async function listResumeChunksToEmbed(db: pg.Pool, tag: string): Promise<{ id: number; section: ResumeSection; content: string }[]> {
  const { rows } = await db.query<{ id: number; section: ResumeSection; content: string }>(
    `SELECT rc.id, rc.section, rc.content FROM resume_chunks rc
       JOIN resume_versions rv ON rv.id = rc.resume_version_id AND rv.is_active
      WHERE rc.embedding_model IS DISTINCT FROM $1
      ORDER BY rc.section, rc.ordinal`,
    [tag],
  );
  return rows;
}

export async function setResumeChunkEmbedding(db: pg.Pool, chunkId: number, embedding: readonly number[], tag: string): Promise<void> {
  await db.query("UPDATE resume_chunks SET embedding = $2::vector, embedding_model = $3 WHERE id = $1", [
    chunkId,
    toVectorLiteral(embedding),
    tag,
  ]);
}

/** Sections of a job that have embedded chunks. */
export async function embeddedJobSections(db: pg.Pool, jobId: string): Promise<Set<JobChunkSection>> {
  const { rows } = await db.query<{ section: JobChunkSection }>(
    "SELECT DISTINCT section FROM job_chunks WHERE job_id = $1 AND embedding IS NOT NULL",
    [jobId],
  );
  return new Set(rows.map((row) => row.section));
}

export interface ChunkMatchRow {
  jobChunkId: number;
  weight: number; // length of the job chunk: longer chunks count more
  resumeChunkId: number;
  resumeSection: ResumeSection;
  cosine: number;
}

/** For every embedded chunk of one section of a job: its closest active-resume chunk. */
export async function bestResumeMatches(db: pg.Pool, jobId: string, section: JobChunkSection): Promise<ChunkMatchRow[]> {
  const { rows } = await db.query<{ job_chunk_id: number; weight: number; resume_chunk_id: number; resume_section: ResumeSection; cosine: number }>(
    `SELECT jc.id AS job_chunk_id, length(jc.content) AS weight,
            best.id AS resume_chunk_id, best.section AS resume_section, 1 - best.distance AS cosine
       FROM job_chunks jc
       CROSS JOIN LATERAL (
         SELECT rc.id, rc.section, rc.embedding <=> jc.embedding AS distance
           FROM resume_chunks rc
           JOIN resume_versions rv ON rv.id = rc.resume_version_id AND rv.is_active
          WHERE rc.embedding IS NOT NULL
          ORDER BY rc.embedding <=> jc.embedding
          LIMIT 1
       ) best
      WHERE jc.job_id = $1 AND jc.section = $2 AND jc.embedding IS NOT NULL
      ORDER BY jc.ordinal`,
    [jobId, section],
  );
  return rows.map((r) => ({
    jobChunkId: r.job_chunk_id,
    weight: r.weight,
    resumeChunkId: r.resume_chunk_id,
    resumeSection: r.resume_section,
    cosine: Number(r.cosine),
  }));
}

/** The k active-resume chunks closest to one job chunk: the retrieval step of RAG. */
export async function nearestResumeChunks(
  db: pg.Pool,
  jobChunkId: number,
  k: number,
): Promise<{ id: number; section: ResumeSection; content: string; cosine: number }[]> {
  const { rows } = await db.query<{ id: number; section: ResumeSection; content: string; cosine: number }>(
    `SELECT rc.id, rc.section, rc.content, 1 - (rc.embedding <=> jc.embedding) AS cosine
       FROM job_chunks jc
       JOIN resume_chunks rc ON rc.embedding IS NOT NULL
       JOIN resume_versions rv ON rv.id = rc.resume_version_id AND rv.is_active
      WHERE jc.id = $1 AND jc.embedding IS NOT NULL
      ORDER BY rc.embedding <=> jc.embedding
      LIMIT $2`,
    [jobChunkId, k],
  );
  return rows.map((r) => ({ ...r, cosine: Number(r.cosine) }));
}

/** Writes a similarity on the job's current match. A scored match is history and is never edited. */
export async function setCurrentMatchSimilarity(db: pg.Pool, jobId: string, similarity: number): Promise<boolean> {
  const { rowCount } = await db.query(
    "UPDATE matches SET similarity = $2 WHERE job_id = $1 AND is_current AND final_score IS NULL",
    [jobId, similarity],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Min-max rescaling: nomic similarities sit in a narrow band (about 0.5–0.8),
 * so they are stretched to 0–1 before being mixed with other scores. Computed
 * over every open job's current match; only unscored matches are written.
 */
export async function normalizeCurrentSimilarities(db: pg.Pool): Promise<{ jobs: number; min: number | null; max: number | null }> {
  const { rows } = await db.query<{ jobs: number; min: number | null; max: number | null }>(
    `WITH current AS (
       SELECT m.id, m.similarity, m.final_score FROM matches m JOIN jobs j ON j.id = m.job_id
        WHERE m.is_current AND j.closed_at IS NULL AND m.similarity IS NOT NULL
     ), bounds AS (SELECT min(similarity) AS lo, max(similarity) AS hi, count(*)::int AS n FROM current),
     updated AS (
       UPDATE matches m
          SET similarity_norm = CASE WHEN b.hi = b.lo THEN 1 ELSE (c.similarity - b.lo) / (b.hi - b.lo) END
         FROM current c, bounds b
        WHERE m.id = c.id AND c.final_score IS NULL
       RETURNING 1
     )
     SELECT b.n AS jobs, b.lo AS min, b.hi AS max FROM bounds b`,
  );
  const row = rows[0]!;
  return { jobs: row.jobs, min: row.min === null ? null : Number(row.min), max: row.max === null ? null : Number(row.max) };
}

/** All of a job's chunks, in reading order, with whether each has a vector. */
export async function getJobChunks(db: pg.Pool, jobId: string): Promise<{ id: number; section: JobChunkSection; content: string; embedded: boolean }[]> {
  const { rows } = await db.query<{ id: number; section: JobChunkSection; content: string; embedded: boolean }>(
    "SELECT id, section, content, embedding IS NOT NULL AS embedded FROM job_chunks WHERE job_id = $1 ORDER BY id",
    [jobId],
  );
  return rows;
}
