import { MIGRATIONS_DIR } from "@kira/shared/db";
import pg from "pg";
import { pino } from "pino";
import { loadMigrationFiles, runMigrations } from "./migrate.ts";

/** Set to run integration tests; unset, they are skipped. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Wipes the test database's public schema. Refuses any database whose name doesn't end in "_test". */
export async function wipeTestDatabase(client: pg.ClientBase): Promise<void> {
  const { rows } = await client.query<{ db: string }>("SELECT current_database() AS db");
  if (!rows[0]?.db.endsWith("_test")) throw new Error(`Refusing to wipe "${rows[0]?.db}": TEST_DATABASE_URL must point at a *_test database`);
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
}

/** A pool on a freshly wiped and migrated test database. */
export async function createMigratedTestPool(): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  const client = await pool.connect();
  try {
    await wipeTestDatabase(client);
    await runMigrations(client, await loadMigrationFiles(MIGRATIONS_DIR), pino({ level: "silent" }));
  } finally {
    client.release();
  }
  return pool;
}
