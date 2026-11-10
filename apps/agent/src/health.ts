import type pg from "pg";
import type { CheckResult } from "@kira/shared";

/** Resolves when the dependency is reachable, throws otherwise. */
export type HealthCheck = () => Promise<void>;

export async function runCheck(check: HealthCheck): Promise<CheckResult> {
  const started = performance.now();
  try {
    await check();
    return { ok: true, latencyMs: elapsed(started) };
  } catch (err) {
    return { ok: false, latencyMs: elapsed(started), error: err instanceof Error ? err.message : String(err) };
  }
}

export function dbCheck(pool: pg.Pool): HealthCheck {
  return async () => {
    await pool.query("select 1");
  };
}

export function ollamaCheck(baseUrl: string, timeoutMs = 2_000): HealthCheck {
  return async () => {
    const res = await fetch(new URL("/api/version", baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
  };
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}
