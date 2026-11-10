import pg from "pg";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 5,
    // Fail fast when Postgres is down instead of hanging the caller.
    connectionTimeoutMillis: 2_000,
  });
}
