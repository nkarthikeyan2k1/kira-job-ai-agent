// Shared HTTP transport for fetchers: host allowlist, per-host rate limit,
// timeout, body cap, and bounded retry with backoff.

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs: number;
  maxBodyBytes: number;
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetryAfterMs: number;
  minIntervalMs: number;
  // Injected in tests so nothing touches the network or waits on a real clock.
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export interface JsonRequest {
  /** Exact hostnames this request may go to; anything else is refused before any I/O. */
  allowedHosts: readonly string[];
  method?: "GET" | "POST";
  /** Sent as a JSON body. */
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpClient {
  getJson(url: string, request: JsonRequest): Promise<unknown>;
}

/** A non-2xx response. */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
    url: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}`);
  }
}

/** The request broke one of our own rules (host, protocol, size); retrying cannot help. */
export class HttpPolicyError extends Error {
  override name = "HttpPolicyError";
}

const JITTER_MS = 250;

/** `Retry-After` is either seconds or an HTTP date. */
export function parseRetryAfterMs(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpPolicyError || err instanceof SyntaxError) return false;
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  // A refused redirect is deterministic; undici reports it as a TypeError with this cause.
  if (err instanceof TypeError && (err.cause as Error | undefined)?.message === "unexpected redirect") return false;
  return true; // network failure or timeout
}

async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new HttpPolicyError(`Response body is ${declared} bytes, over the ${maxBytes} byte limit`);
  }
  if (!res.body) return res.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new HttpPolicyError(`Response body exceeded the ${maxBytes} byte limit`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;

  // Per-host politeness: each request waits for the previous one to that host
  // plus the minimum interval. Chaining promises keeps it correct even if
  // callers ever run concurrently.
  const hostQueues = new Map<string, Promise<void>>();
  const lastRequestAt = new Map<string, number>();
  function waitForTurn(host: string): Promise<void> {
    const turn = (hostQueues.get(host) ?? Promise.resolve()).then(async () => {
      const last = lastRequestAt.get(host);
      if (last !== undefined) {
        const wait = last + options.minIntervalMs - now();
        if (wait > 0) await sleep(wait);
      }
      lastRequestAt.set(host, now());
    });
    hostQueues.set(host, turn);
    return turn;
  }

  async function attempt(url: URL, request: JsonRequest): Promise<unknown> {
    await waitForTurn(url.host);
    const headers: Record<string, string> = {
      "user-agent": options.userAgent,
      accept: "application/json",
      // Node may otherwise negotiate zstd, which undici has been seen to truncate.
      "accept-encoding": "gzip, deflate, br",
    };
    if (request.body !== undefined) headers["content-type"] = "application/json";

    const res = await doFetch(url, {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      // Never follow a redirect: it could lead off the allowlisted host.
      redirect: "error",
      // Covers the body read too, so a stalled response cannot hang the run.
      signal: AbortSignal.timeout(request.timeoutMs ?? options.timeoutMs),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(res.status, parseRetryAfterMs(res.headers.get("retry-after"), now()), url.href);
    }
    const text = await readBodyCapped(res, options.maxBodyBytes);
    return JSON.parse(text.replace(/^﻿/, ""));
  }

  return {
    async getJson(rawUrl, request) {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:") throw new HttpPolicyError(`Refusing non-HTTPS URL: ${rawUrl}`);
      if (!request.allowedHosts.includes(url.hostname)) {
        throw new HttpPolicyError(`Host "${url.hostname}" is not in the allowlist (${request.allowedHosts.join(", ")})`);
      }

      for (let tries = 0; ; tries++) {
        try {
          return await attempt(url, request);
        } catch (err) {
          if (tries >= options.retries || !isRetryable(err)) throw err;
          // Exponential backoff with jitter; a server-sent Retry-After wins but is clamped.
          const backoff = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** tries) + random() * JITTER_MS;
          const retryAfter = err instanceof HttpError ? err.retryAfterMs : null;
          await sleep(retryAfter === null ? backoff : Math.min(retryAfter, options.maxRetryAfterMs));
        }
      }
    },
  };
}
