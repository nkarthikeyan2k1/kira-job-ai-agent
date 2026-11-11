import { MIGRATIONS_DIR } from "@kira/shared/db";
import { pino } from "pino";
import { loadEnv } from "../env.ts";
import { createPool } from "./client.ts";
import { loadMigrationFiles, readAppliedMigrations, runMigrations } from "./migrate.ts";
import { planMigrations } from "./migrate-plan.ts";

// `npm run db:migrate` applies pending migrations; `-- --status` only lists them.
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const pool = createPool(env.DATABASE_URL);

try {
  const client = await pool.connect();
  try {
    const files = await loadMigrationFiles(MIGRATIONS_DIR);
    if (process.argv.includes("--status")) {
      const applied = await readAppliedMigrations(client);
      const pending = planMigrations(files, applied);
      log.info({ applied: applied.map((m) => `${m.version}_${m.name}`), pending: pending.map((m) => `${m.version}_${m.name}`) }, "migration status");
    } else {
      const done = await runMigrations(client, files, log);
      log.info(done.length === 0 ? "database is up to date" : `applied ${done.length} migration(s)`);
    }
  } finally {
    client.release();
  }
} catch (err) {
  log.fatal({ err }, "migration failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
