import type { z } from "zod";
import { EMBEDDING, GENERATION, LLM_ROUTING, type EmbedTask, type GenerateTask, type LlmTask } from "../../config/llm-routing.ts";
import { ModelInputError, ModelUnavailableError, ollamaChat, ollamaEmbed } from "./ollama.ts";
import { assertVector } from "./vector.ts";

export { ModelInputError, ModelUnavailableError };

/** The model answered, but not with valid JSON for the schema, even after a retry. Skip this item. */
export class ModelOutputError extends Error {
  override name = "ModelOutputError";
}

/** One row for llm_calls: what every model call cost and how it went. */
export interface LlmCallRecord {
  task: string;
  tier: "local" | "paid";
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  error: string | null;
  jobId: string | null;
  promptVersion: string | null;
}

export interface GenerateJsonRequest<S extends z.ZodType> {
  system: string;
  user: string;
  /** Validates the answer; its JSON schema is also sent to the model to constrain generation. */
  schema: S;
  jsonSchema: object;
  promptVersion: string;
  jobId?: string;
}

export interface LlmClient {
  /** Embeds texts for a task; returns one vector per text, in order. The task's prefix is added here. */
  embed(task: EmbedTask, texts: readonly string[], meta?: { jobId?: string }): Promise<number[][]>;
  /** Asks a generation model for JSON matching `schema`. Returns the validated value and the model used. */
  generateJson<S extends z.ZodType>(task: GenerateTask, request: GenerateJsonRequest<S>): Promise<{ value: z.infer<S>; model: string }>;
}

export interface LlmClientOptions {
  ollamaUrl: string;
  recordCall: (record: LlmCallRecord) => Promise<void>;
  // Injected in tests: no network, no real clock.
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * The single door to every model. It applies the routing config, retries a
 * failed call once, validates what comes back and logs every attempt to
 * llm_calls. Local models only for now; there is no paid fallback, so when
 * Ollama is down the caller gets ModelUnavailableError and defers the work.
 */
export function createLlmClient(options: LlmClientOptions): LlmClient {
  const now = options.now ?? (() => performance.now());

  function recorder(task: LlmTask, model: string, jobId: string | null, promptVersion: string | null) {
    const started = now();
    return (ok: boolean, tokensIn: number, tokensOut: number, error: string | null) =>
      options.recordCall({
        task,
        tier: LLM_ROUTING[task].tier,
        model,
        tokensIn,
        tokensOut,
        costUsd: 0, // local models cost nothing per call
        latencyMs: Math.round(now() - started),
        ok,
        error,
        jobId,
        promptVersion,
      });
  }

  return {
    async embed(task, texts, meta) {
      if (texts.length === 0) return [];
      const route = LLM_ROUTING[task];
      const input = texts.map((text) => route.prefix + text);

      for (let attempt = 0; ; attempt++) {
        const record = recorder(task, route.model, meta?.jobId ?? null, null);
        try {
          const { embeddings, promptTokens } = await ollamaEmbed({
            baseUrl: options.ollamaUrl,
            model: route.model,
            input,
            numCtx: EMBEDDING.numCtx,
            keepAlive: EMBEDDING.keepAlive,
            timeoutMs: EMBEDDING.timeoutMs,
            fetch: options.fetch,
          });
          if (embeddings.length !== texts.length) {
            throw new Error(`Asked for ${texts.length} embeddings, got ${embeddings.length}`);
          }
          for (const vector of embeddings) assertVector(vector, EMBEDDING.dimensions);
          await record(true, promptTokens, 0, null);
          return embeddings;
        } catch (err) {
          await record(false, 0, 0, err instanceof Error ? err.message : String(err));
          if (!(err instanceof ModelUnavailableError) || attempt >= EMBEDDING.retries) throw err;
        }
      }
    },

    async generateJson(task, request) {
      const route = LLM_ROUTING[task];
      let unavailable = 0;
      let invalid = 0;

      for (;;) {
        const record = recorder(task, route.model, request.jobId ?? null, request.promptVersion);
        try {
          const result = await ollamaChat({
            baseUrl: options.ollamaUrl,
            model: route.model,
            system: request.system,
            user: request.user,
            format: request.jsonSchema,
            numCtx: GENERATION.numCtx,
            temperature: GENERATION.temperature,
            seed: GENERATION.seed,
            keepAlive: GENERATION.keepAlive,
            timeoutMs: GENERATION.timeoutMs,
            fetch: options.fetch,
          });
          // A prompt that fills the whole window was cut by Ollama: the model never saw all of it.
          if (result.promptTokens >= GENERATION.numCtx) {
            throw new ModelInputError(`Prompt used ${result.promptTokens} tokens, the whole ${GENERATION.numCtx}-token window`);
          }
          if (result.doneReason === "length") throw new ModelOutputError("Answer was cut at the context limit");

          let parsed: unknown;
          try {
            parsed = JSON.parse(result.content);
          } catch {
            throw new ModelOutputError("Answer is not valid JSON");
          }
          const validated = request.schema.safeParse(parsed);
          if (!validated.success) throw new ModelOutputError(`Answer does not match the schema: ${validated.error.message.slice(0, 300)}`);

          await record(true, result.promptTokens, result.outputTokens, null);
          return { value: validated.data, model: route.model };
        } catch (err) {
          await record(false, 0, 0, err instanceof Error ? err.message : String(err));
          if (err instanceof ModelUnavailableError && unavailable++ < GENERATION.retries) continue;
          if (err instanceof ModelOutputError && invalid++ < GENERATION.invalidOutputRetries) continue;
          throw err;
        }
      }
    },
  };
}
