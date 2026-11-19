import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLlmClient, ModelInputError, ModelOutputError, ModelUnavailableError, type LlmCallRecord } from "./llm-client.ts";
import { cosine, toVectorLiteral } from "./vector.ts";

type Reply = Response | Error;
const vector = (fill = 0.1) => Array.from({ length: 768 }, () => fill);
const ok = (count: number, tokens = 12) =>
  new Response(JSON.stringify({ embeddings: Array.from({ length: count }, () => vector()), prompt_eval_count: tokens }));

function harness(replies: Reply[]) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const calls: LlmCallRecord[] = [];
  let clock = 0;
  const client = createLlmClient({
    ollamaUrl: "http://localhost:11434",
    recordCall: async (record) => {
      calls.push(record);
    },
    now: () => (clock += 5),
    fetch: (async (url: URL | string, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      const reply = replies.shift();
      if (!reply) throw new Error("test: no reply queued");
      if (reply instanceof Error) throw reply;
      return reply;
    }) as typeof fetch,
  });
  return { client, requests, calls };
}

describe("createLlmClient().embed", () => {
  it("adds the task's prefix and sends the settings that stop silent truncation", async () => {
    const { client, requests } = harness([ok(2)]);

    const vectors = await client.embed("embed.job_chunk", ["Requirements\n- Node.js", "Responsibilities"]);

    expect(vectors).toHaveLength(2);
    expect(requests[0]!.url).toBe("http://localhost:11434/api/embed");
    expect(requests[0]!.body).toEqual({
      model: "nomic-embed-text",
      input: ["search_document: Requirements\n- Node.js", "search_document: Responsibilities"],
      truncate: false,
      keep_alive: "10m",
      options: { num_ctx: 2048 },
    });
  });

  it("uses the query prefix for resume text", async () => {
    const { client, requests } = harness([ok(1)]);
    await client.embed("embed.resume_chunk", ["Built a Node.js service"]);
    expect(requests[0]!.body.input).toEqual(["search_query: Built a Node.js service"]);
  });

  it("logs every call to llm_calls", async () => {
    const { client, calls } = harness([ok(1, 40)]);
    await client.embed("embed.job_chunk", ["text"], { jobId: "gh:acme:1" });
    expect(calls).toEqual([
      { task: "embed.job_chunk", tier: "local", model: "nomic-embed-text", tokensIn: 40, tokensOut: 0, costUsd: 0, latencyMs: 5, ok: true, error: null, jobId: "gh:acme:1", promptVersion: null },
    ]);
  });

  it("retries once when Ollama is unreachable or failing, then succeeds", async () => {
    const { client, requests, calls } = harness([new TypeError("fetch failed"), ok(1)]);

    await expect(client.embed("embed.job_chunk", ["text"])).resolves.toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(calls.map((c) => c.ok)).toEqual([false, true]);
  });

  it("gives up with ModelUnavailableError after the retry", async () => {
    const { client, requests } = harness([new Response("busy", { status: 503 }), new TypeError("ECONNREFUSED")]);

    await expect(client.embed("embed.job_chunk", ["text"])).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(requests).toHaveLength(2);
  });

  it("reports a model that is not pulled as unavailable", async () => {
    const { client } = harness([new Response('{"error":"model not found"}', { status: 404 }), new Response("", { status: 404 })]);
    await expect(client.embed("embed.job_chunk", ["text"])).rejects.toThrow(/404/);
  });

  it("does not retry input the model refused", async () => {
    const { client, requests } = harness([new Response('{"error":"the input length exceeds the context length"}', { status: 400 })]);

    await expect(client.embed("embed.job_chunk", ["very long"])).rejects.toBeInstanceOf(ModelInputError);
    expect(requests).toHaveLength(1);
  });

  it("rejects vectors of the wrong size or count", async () => {
    const short = new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }));
    await expect(harness([short]).client.embed("embed.job_chunk", ["text"])).rejects.toThrow(/768/);
    await expect(harness([ok(1)]).client.embed("embed.job_chunk", ["a", "b"])).rejects.toThrow(/Asked for 2/);
  });

  it("makes no call for an empty list", async () => {
    const { client, requests } = harness([]);
    await expect(client.embed("embed.job_chunk", [])).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });
});

describe("vector helpers", () => {
  it("measures direction, not length", () => {
    expect(cosine([1, 0], [5, 0])).toBe(1);
    expect(cosine([1, 0], [0, 3])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("writes pgvector's text form", () => {
    expect(toVectorLiteral([0.5, -1, 2])).toBe("[0.5,-1,2]");
  });
});

describe("createLlmClient().generateJson", () => {
  const schema = z.object({ answer: z.enum(["yes", "no"]) });
  const request = { system: "sys", user: "usr", schema, jsonSchema: z.toJSONSchema(schema), promptVersion: "test/v1", jobId: "gh:acme:1" };
  const chat = (content: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ message: { content }, done_reason: "stop", prompt_eval_count: 900, eval_count: 30, ...extra }));

  it("sends the schema and deterministic settings, and returns the validated answer", async () => {
    const { client, requests, calls } = harness([chat('{"answer":"yes"}')]);

    await expect(client.generateJson("score.extract_requirements", request)).resolves.toEqual({ value: { answer: "yes" }, model: "qwen2.5:7b" });

    expect(requests[0]!.url).toBe("http://localhost:11434/api/chat");
    expect(requests[0]!.body).toMatchObject({
      model: "qwen2.5:7b",
      stream: false,
      format: request.jsonSchema,
      options: { num_ctx: 8192, temperature: 0, seed: 1 },
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "usr" }],
    });
    expect(calls[0]).toMatchObject({ task: "score.extract_requirements", ok: true, tokensIn: 900, tokensOut: 30, promptVersion: "test/v1", jobId: "gh:acme:1" });
  });

  it("asks again once when the answer is not valid, then gives up with ModelOutputError", async () => {
    const retried = harness([chat("not json"), chat('{"answer":"yes"}')]);
    await expect(retried.client.generateJson("score.extract_requirements", request)).resolves.toMatchObject({ value: { answer: "yes" } });
    expect(retried.calls.map((c) => c.ok)).toEqual([false, true]);

    const failing = harness([chat('{"answer":"maybe"}'), chat('{"answer":"perhaps"}')]);
    await expect(failing.client.generateJson("score.extract_requirements", request)).rejects.toBeInstanceOf(ModelOutputError);
    expect(failing.requests).toHaveLength(2);
  });

  it("treats an answer cut at the context limit as invalid", async () => {
    const { client } = harness([chat('{"answer":', { done_reason: "length" }), chat('{"answer":', { done_reason: "length" })]);
    await expect(client.generateJson("score.extract_requirements", request)).rejects.toThrow(/cut at the context limit/);
  });

  it("refuses a result whose prompt filled the whole window (Ollama cut the prompt)", async () => {
    const { client, requests } = harness([chat('{"answer":"yes"}', { prompt_eval_count: 8192 })]);
    await expect(client.generateJson("score.extract_requirements", request)).rejects.toBeInstanceOf(ModelInputError);
    expect(requests).toHaveLength(1);
  });

  it("retries once when Ollama is unreachable, then reports it unavailable", async () => {
    const { client, requests } = harness([new TypeError("fetch failed"), new TypeError("fetch failed")]);
    await expect(client.generateJson("score.extract_requirements", request)).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(requests).toHaveLength(2);
  });
});
