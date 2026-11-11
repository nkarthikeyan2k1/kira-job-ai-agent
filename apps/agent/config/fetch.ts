import { fileURLToPath } from "node:url";

// Every tunable of the fetch stage in one place.
export const FETCH_CONFIG = {
  // Honest identification, no browser impersonation.
  userAgent: "kira-job-agent/0.1 (personal job search)",
  rawDir: fileURLToPath(new URL("../data/raw/", import.meta.url)),
  rawRetentionDays: 7,
  http: {
    timeoutMs: 15_000,
    maxBodyBytes: 50 * 1024 * 1024,
    retries: 2, // 3 attempts in total
    baseDelayMs: 500,
    maxDelayMs: 8_000,
    maxRetryAfterMs: 30_000, // never let a server's Retry-After stall the run for longer
    minIntervalMs: 1_000, // at most 1 request per second per host
  },
  // Lever returns a whole board, descriptions included, in one response.
  leverTimeoutMs: 30_000,
  peoplestrong: {
    pageSize: 200,
    maxPages: 25,
    // One detail request per new job at 1 req/s: cap what a single run may spend.
    maxDetailFetchesPerRun: 300,
  },
} as const;
