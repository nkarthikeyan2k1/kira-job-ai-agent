// Pure planning logic for the migration runner: no I/O, so every rule is unit-tested.

export interface MigrationFile {
  version: number;
  name: string;
  checksum: string; // SHA-256 of the file contents
  sql: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

export class MigrationError extends Error {
  override name = "MigrationError";
}

const FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** "0001_init.sql" → { version: 1, name: "init" }; null when the name doesn't follow the convention. */
export function parseMigrationFilename(filename: string): { version: number; name: string } | null {
  const match = FILENAME.exec(filename);
  if (!match) return null;
  return { version: Number(match[1]), name: match[2]! };
}

/**
 * Returns the migrations still to run, in order. Throws when the files and the
 * database history disagree, because guessing here could corrupt the schema:
 * - versions must be 1, 2, 3… with no gaps or duplicates
 * - every applied migration must still exist, unchanged (same checksum)
 */
export function planMigrations(files: readonly MigrationFile[], applied: readonly AppliedMigration[]): MigrationFile[] {
  const sorted = [...files].sort((a, b) => a.version - b.version);
  sorted.forEach((file, index) => {
    if (file.version !== index + 1) {
      throw new MigrationError(
        `Migration versions must be 1, 2, 3… without gaps or duplicates; expected ${index + 1}, found ${file.version} (${file.name}).`,
      );
    }
  });

  const byVersion = new Map(sorted.map((file) => [file.version, file]));
  for (const row of applied) {
    const file = byVersion.get(row.version);
    if (!file) {
      throw new MigrationError(`Migration ${row.version} (${row.name}) is applied in the database but its file is missing.`);
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationError(
        `Migration ${row.version} (${row.name}) was edited after it was applied. Never change an applied migration; add a new one.`,
      );
    }
  }

  // Versions are contiguous and every applied one has a file, but the applied
  // set itself could still have a hole (e.g. 1 and 3 applied, 2 not).
  const appliedVersions = new Set(applied.map((row) => row.version));
  const pending = sorted.filter((file) => !appliedVersions.has(file.version));
  const maxApplied = Math.max(0, ...appliedVersions);
  const skipped = pending.find((file) => file.version < maxApplied);
  if (skipped) {
    throw new MigrationError(`Migration ${skipped.version} (${skipped.name}) is pending but a later one is already applied.`);
  }
  return pending;
}
