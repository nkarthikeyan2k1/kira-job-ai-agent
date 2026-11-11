import "server-only";
import { Pool, type QueryResultRow } from "pg";

// One pool per server process. In dev, hot reload re-evaluates this module, so
// the pool is parked on globalThis to avoid leaking connections on every edit.
const globalForDb = globalThis as typeof globalThis & { __kiraPool?: Pool };

function getPool(): Pool {
  if (!globalForDb.__kiraPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set: copy .env.example to .env in the repo root");
    globalForDb.__kiraPool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 2_000 });
  }
  return globalForDb.__kiraPool;
}

export async function query(sql: string, params: readonly unknown[] = []): Promise<QueryResultRow[]> {
  const { rows } = await getPool().query(sql, [...params]);
  return rows;
}
