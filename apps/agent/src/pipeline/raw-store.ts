import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * Archives a source's payload as received, gzipped, under <rawDir>/<YYYY-MM-DD>/.
 * It lets a parser fix be replayed without fetching again.
 */
export async function saveRawPayload(rawDir: string, companyId: string, payload: unknown, now: Date): Promise<string> {
  const iso = now.toISOString(); // 2026-11-12T08:15:30.000Z
  const dir = path.join(rawDir, iso.slice(0, 10));
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${companyId}-${iso.slice(11, 19).replaceAll(":", "")}.json.gz`);
  await writeFile(file, await gzipAsync(JSON.stringify(payload)));
  return file;
}

/** Deletes day folders older than the retention window; returns the folders removed. */
export async function pruneRawPayloads(rawDir: string, retentionDays: number, now: Date): Promise<string[]> {
  const entries = await readdir(rawDir, { withFileTypes: true }).catch(() => []);
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const removed: string[] = [];
  for (const entry of entries) {
    // Only folders this module created (named as a date) are ever deleted.
    if (!entry.isDirectory() || !DAY_DIR.test(entry.name)) continue;
    if (new Date(`${entry.name}T00:00:00Z`).getTime() + DAY_MS <= cutoff) {
      await rm(path.join(rawDir, entry.name), { recursive: true });
      removed.push(entry.name);
    }
  }
  return removed;
}
