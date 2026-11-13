import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { saveResumeVersion, type SaveResumeOutcome } from "../db/resume-repo.ts";
import { latexToText } from "./latex-to-text.ts";
import { pdfTextToResumeText } from "./pdf-text.ts";
import { splitResume, type ResumeChunkDraft } from "./sections.ts";

export interface ResumeImportResult {
  versionId: number;
  outcome: SaveResumeOutcome;
  source: string;
  chunks: ResumeChunkDraft[];
}

async function readIfExists(file: string): Promise<Buffer | null> {
  return readFile(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
}

async function extractPdfText(data: Buffer): Promise<string> {
  // Loaded only on this path: the PDF library is large and rarely needed.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

/**
 * Imports the master resume: the LaTeX source when present, else the PDF.
 * The file's hash identifies the version, so importing an unchanged file
 * changes nothing. Chunks are stored without embeddings (stage [3] adds them).
 */
export async function importResume(db: pg.Pool, files: { tex: string; pdf: string }, now: Date = new Date()): Promise<ResumeImportResult> {
  const tex = await readIfExists(files.tex);
  const pdf = tex ? null : await readIfExists(files.pdf);
  if (!tex && !pdf) throw new Error(`No resume found: put the Overleaf source at ${files.tex} (or a PDF at ${files.pdf})`);

  const source = tex ? files.tex : files.pdf;
  const bytes = (tex ?? pdf)!;
  const text = tex ? latexToText(tex.toString("utf8")) : pdfTextToResumeText(await extractPdfText(pdf!));
  const chunks = splitResume(text);
  if (chunks.length === 0) throw new Error(`No text could be read from ${source}`);

  const { id, outcome } = await saveResumeVersion(db, {
    label: `${path.basename(source)} ${now.toISOString().slice(0, 10)}`,
    sourcePath: source,
    content: text,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    chunks,
  });
  return { versionId: id, outcome, source, chunks };
}
