import { z } from "zod";

/** Ollama could not be reached or failed on its side (down, asleep, timeout, 5xx). Worth retrying later. */
export class ModelUnavailableError extends Error {
  override name = "ModelUnavailableError";
}

/** Ollama refused the input itself (e.g. longer than the model's context). Retrying won't help. */
export class ModelInputError extends Error {
  override name = "ModelInputError";
}

const ChatResponseSchema = z.object({
  message: z.object({ content: z.string() }),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

export interface OllamaChatRequest {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  /** JSON schema the answer must follow: Ollama constrains generation to it. */
  format: object;
  numCtx: number;
  temperature: number;
  seed: number;
  keepAlive: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface OllamaChatResult {
  content: string;
  promptTokens: number;
  outputTokens: number;
  /** "length" means the answer hit the context limit and was cut. */
  doneReason: string | null;
}

/** One POST to /api/chat (non-streaming). No retry here; the LLM client owns that policy. */
export async function ollamaChat(request: OllamaChatRequest): Promise<OllamaChatResult> {
  const doFetch = request.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(new URL("/api/chat", request.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        format: request.format,
        keep_alive: request.keepAlive,
        options: { num_ctx: request.numCtx, temperature: request.temperature, seed: request.seed },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (err) {
    throw new ModelUnavailableError(`Ollama unreachable at ${request.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const message = `Ollama ${res.status}: ${detail.slice(0, 300)}`;
    if (res.status === 400) throw new ModelInputError(message);
    throw new ModelUnavailableError(message);
  }

  const body = ChatResponseSchema.parse(await res.json());
  return {
    content: body.message.content,
    promptTokens: body.prompt_eval_count ?? 0,
    outputTokens: body.eval_count ?? 0,
    doneReason: body.done_reason ?? null,
  };
}

const EmbedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
  prompt_eval_count: z.number().int().nonnegative().optional(),
});

export interface OllamaEmbedRequest {
  baseUrl: string;
  model: string;
  input: readonly string[];
  numCtx: number;
  keepAlive: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/** One POST to /api/embed. No retry here; the LLM client owns that policy. */
export async function ollamaEmbed(request: OllamaEmbedRequest): Promise<{ embeddings: number[][]; promptTokens: number }> {
  const doFetch = request.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(new URL("/api/embed", request.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        input: request.input,
        truncate: false, // error on over-long input instead of silently cutting it
        keep_alive: request.keepAlive,
        options: { num_ctx: request.numCtx },
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (err) {
    throw new ModelUnavailableError(`Ollama unreachable at ${request.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const message = `Ollama ${res.status}: ${detail.slice(0, 300)}`;
    if (res.status === 400) throw new ModelInputError(message);
    throw new ModelUnavailableError(message); // 404 (model not pulled), 5xx…
  }

  const body = EmbedResponseSchema.parse(await res.json());
  return { embeddings: body.embeddings, promptTokens: body.prompt_eval_count ?? 0 };
}
