import { describe, expect, it } from "vitest";
import { createHttpClient, HttpError, HttpPolicyError, parseRetryAfterMs, type HttpClientOptions } from "./http.ts";

type Reply = Response | Error;

// A fake transport and clock: no network, no real waiting.
function harness(replies: Reply[], overrides: Partial<HttpClientOptions> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const client = createHttpClient({
    userAgent: "kira-test/1.0",
    timeoutMs: 1_000,
    maxBodyBytes: 1_000,
    retries: 2,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
    maxRetryAfterMs: 30_000,
    minIntervalMs: 0,
    fetch: (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const reply = replies.shift();
      if (!reply) throw new Error("test: no reply queued");
      if (reply instanceof Error) throw reply;
      return reply;
    }) as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    random: () => 0,
    ...overrides,
  });
  return { client, calls, sleeps };
}

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const request = { allowedHosts: ["api.example.com"] };
const URL_OK = "https://api.example.com/jobs";

describe("createHttpClient", () => {
  it("returns parsed JSON and identifies itself honestly", async () => {
    const { client, calls } = harness([json({ jobs: [1, 2] })]);

    await expect(client.getJson(URL_OK, request)).resolves.toEqual({ jobs: [1, 2] });

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe("kira-test/1.0");
    expect(headers["accept-encoding"]).toBe("gzip, deflate, br");
    expect(calls[0]!.init.redirect).toBe("error");
  });

  it("sends a JSON body on POST", async () => {
    const { client, calls } = harness([json({})]);

    await client.getJson(URL_OK, { ...request, method: "POST", body: { limit: 5 } });

    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe('{"limit":5}');
    expect((calls[0]!.init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("refuses hosts outside the allowlist and non-HTTPS URLs before any request", async () => {
    const { client, calls } = harness([]);

    await expect(client.getJson("https://evil.example.org/jobs", request)).rejects.toThrow(HttpPolicyError);
    await expect(client.getJson("http://api.example.com/jobs", request)).rejects.toThrow(HttpPolicyError);
    expect(calls).toHaveLength(0);
  });

  it("retries 5xx with exponential backoff, then succeeds", async () => {
    const { client, calls, sleeps } = harness([new Response("", { status: 503 }), new Response("", { status: 502 }), json({ ok: true })]);

    await expect(client.getJson(URL_OK, request)).resolves.toEqual({ ok: true });

    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1_000]);
  });

  it("retries a network failure", async () => {
    const { client, calls } = harness([new TypeError("fetch failed"), json({ ok: true })]);

    await expect(client.getJson(URL_OK, request)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("does not retry a 4xx other than 429", async () => {
    const { client, calls, sleeps } = harness([new Response("", { status: 404 })]);

    await expect(client.getJson(URL_OK, request)).rejects.toMatchObject({ name: "HttpError", status: 404 });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("gives up after the configured number of retries", async () => {
    const { client, calls } = harness([1, 2, 3].map(() => new Response("", { status: 429 })));

    await expect(client.getJson(URL_OK, request)).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(3);
  });

  it("honours Retry-After but clamps it", async () => {
    const { client, sleeps } = harness([
      new Response("", { status: 429, headers: { "retry-after": "2" } }),
      new Response("", { status: 429, headers: { "retry-after": "86400" } }),
      json({ ok: true }),
    ]);

    await client.getJson(URL_OK, request);

    expect(sleeps).toEqual([2_000, 30_000]);
  });

  it("refuses a body over the size limit and does not retry it", async () => {
    const { client, calls } = harness([new Response("x".repeat(2_000))]);

    await expect(client.getJson(URL_OK, request)).rejects.toThrow(/byte limit/);
    expect(calls).toHaveLength(1);
  });

  it("does not retry invalid JSON", async () => {
    const { client, calls } = harness([new Response("<html>challenge</html>")]);

    await expect(client.getJson(URL_OK, request)).rejects.toThrow(SyntaxError);
    expect(calls).toHaveLength(1);
  });

  it("spaces requests to the same host, but not to different hosts", async () => {
    const { client, sleeps } = harness([json(1), json(2), json(3)], { minIntervalMs: 1_000 });
    const both = { allowedHosts: ["api.example.com", "other.example.com"] };

    await client.getJson(URL_OK, both);
    await client.getJson("https://other.example.com/jobs", both);
    expect(sleeps).toEqual([]);

    await client.getJson(URL_OK, both);
    expect(sleeps).toEqual([1_000]);
  });
});

describe("parseRetryAfterMs", () => {
  it("reads seconds and HTTP dates", () => {
    const now = Date.parse("2026-11-12T00:00:00Z");
    expect(parseRetryAfterMs("5", now)).toBe(5_000);
    expect(parseRetryAfterMs("Thu, 12 Nov 2026 00:00:10 GMT", now)).toBe(10_000);
    expect(parseRetryAfterMs(null, now)).toBeNull();
    expect(parseRetryAfterMs("soon", now)).toBeNull();
  });
});
