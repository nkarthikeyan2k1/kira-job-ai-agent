import type { ResumeSection } from "@kira/shared";
import type pg from "pg";

export interface NewResumeChunk {
  section: ResumeSection;
  ordinal: number;
  content: string;
}

export interface NewResumeVersion {
  label: string;
  sourcePath: string;
  content: string;
  contentHash: string;
  chunks: readonly NewResumeChunk[];
}

export type SaveResumeOutcome = "created" | "reactivated" | "unchanged";

/** Id of the resume version scores are computed against; null until a resume is imported. */
export async function getActiveResumeVersionId(db: pg.Pool): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>("SELECT id FROM resume_versions WHERE is_active");
  return rows[0]?.id ?? null;
}

/**
 * Stores a resume and makes it the active version. The content hash decides
 * what happens: an unchanged resume is a no-op, a previously imported one is
 * re-activated, and a new one is stored with its chunks (embeddings come later).
 */
export async function saveResumeVersion(db: pg.Pool, resume: NewResumeVersion): Promise<{ id: number; outcome: SaveResumeOutcome }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: number; is_active: boolean }>(
      "SELECT id, is_active FROM resume_versions WHERE content_hash = $1 FOR UPDATE",
      [resume.contentHash],
    );
    const known = existing.rows[0];
    if (known?.is_active) {
      await client.query("COMMIT");
      return { id: known.id, outcome: "unchanged" };
    }

    // Only one version may be active (partial unique index), so clear the old one first.
    await client.query("UPDATE resume_versions SET is_active = false WHERE is_active");
    if (known) {
      await client.query("UPDATE resume_versions SET is_active = true WHERE id = $1", [known.id]);
      await client.query("COMMIT");
      return { id: known.id, outcome: "reactivated" };
    }

    const inserted = await client.query<{ id: number }>(
      "INSERT INTO resume_versions (label, source_path, content, content_hash, is_active) VALUES ($1, $2, $3, $4, true) RETURNING id",
      [resume.label, resume.sourcePath, resume.content, resume.contentHash],
    );
    const id = inserted.rows[0]!.id;
    for (const chunk of resume.chunks) {
      await client.query("INSERT INTO resume_chunks (resume_version_id, section, ordinal, content) VALUES ($1, $2, $3, $4)", [
        id,
        chunk.section,
        chunk.ordinal,
        chunk.content,
      ]);
    }
    await client.query("COMMIT");
    return { id, outcome: "created" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** The active resume: its full text and its chunks. Null until a resume is imported. */
export async function getActiveResume(
  db: pg.Pool,
): Promise<{ id: number; content: string; chunks: { id: number; section: ResumeSection; content: string }[] } | null> {
  const version = await db.query<{ id: number; content: string }>("SELECT id, content FROM resume_versions WHERE is_active");
  const active = version.rows[0];
  if (!active) return null;
  const chunks = await db.query<{ id: number; section: ResumeSection; content: string }>(
    "SELECT id, section, content FROM resume_chunks WHERE resume_version_id = $1 ORDER BY id",
    [active.id],
  );
  return { id: active.id, content: active.content, chunks: chunks.rows };
}
