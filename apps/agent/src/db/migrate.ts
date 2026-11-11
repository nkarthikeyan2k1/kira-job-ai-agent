import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import type { Logger } from "pino";
import { parseMigrationFilename, planMigrations, type AppliedMigration, type MigrationFile } from "./migrate-plan.ts";

// Arbitrary constant: the advisory-lock key that serialises migration runs.
const MIGRATION_LOCK_KEY = 5_472_001;

export async function loadMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const files: MigrationFile[] = [];
  for (const filename of (await readdir(dir)).sort()) {
    if (!filename.endsWith(".sql")) continue;
    const parsed = parseMigrationFilename(filename);
    if (!parsed) throw new Error(`Migration file "${filename}" must be named NNNN_snake_case.sql`);
    const sql = await readFile(path.join(dir, filename), "utf8");
    files.push({ ...parsed, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return files;
}

export async function readAppliedMigrations(client: pg.ClientBase): Promise<AppliedMigration[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    integer PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const { rows } = await client.query<AppliedMigration>("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
  return rows;
}

/**
 * Applies every pending migration, each in its own transaction, and returns
 * the ones it applied. Forward-only: there are no down migrations.
 */
export async function runMigrations(client: pg.ClientBase, files: readonly MigrationFile[], log: Logger): Promise<MigrationFile[]> {
  // Session-level lock: a second runner waits here instead of racing us.
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    const pending = planMigrations(files, await readAppliedMigrations(client));
    for (const migration of pending) {
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.version} (${migration.name}) failed and was rolled back`, { cause: err });
      }
      log.info({ version: migration.version, name: migration.name }, "migration applied");
    }
    return pending;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
  }
}
