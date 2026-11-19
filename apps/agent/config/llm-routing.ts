// Every model call names a task; this file says which model serves it and how.
// Moving a task to another model or tier is a one-line change here.

export const LLM_ROUTING = {
  // nomic-embed-text was trained with task prefixes: documents (what is searched)
  // and queries (what searches) get different ones. Without them retrieval
  // quality drops. JD text is the document side, resume text the query side.
  "embed.job_chunk": { kind: "embed", tier: "local", model: "nomic-embed-text", prefix: "search_document: " },
  "embed.resume_chunk": { kind: "embed", tier: "local", model: "nomic-embed-text", prefix: "search_query: " },
  // Stage [4]: per-requirement met/partial/missing with resume quotes. The
  // model reports evidence; the score itself is computed in code.
  "score.extract_requirements": { kind: "generate", tier: "local", model: "qwen2.5:7b" },
} as const;

type Routing = typeof LLM_ROUTING;
export type LlmTask = keyof Routing;
export type EmbedTask = { [K in LlmTask]: Routing[K]["kind"] extends "embed" ? K : never }[LlmTask];
export type GenerateTask = { [K in LlmTask]: Routing[K]["kind"] extends "generate" ? K : never }[LlmTask];

export const EMBEDDING = {
  // Stored next to every vector. Changing the model, the prefixes or the
  // chunker must change this tag: every job and resume chunk is then re-embedded,
  // because vectors from different setups cannot be compared.
  tag: "nomic-embed-text/c1",
  dimensions: 768,
  // nomic-embed-text reads at most 2,048 tokens. Ollama's default is to cut
  // longer input silently; we send truncate: false so it errors instead.
  numCtx: 2048,
  keepAlive: "10m", // keep the model loaded between jobs instead of reloading it
  timeoutMs: 60_000,
  retries: 1,
} as const;

export const GENERATION = {
  // Context window in tokens (prompt + answer). Ollama's default is small and
  // cuts longer prompts silently, so it is always set explicitly.
  numCtx: 8192,
  // temperature 0 + a fixed seed: the same prompt gives the same answer, so
  // scores are reproducible and comparable between runs.
  temperature: 0,
  seed: 1,
  keepAlive: "10m",
  timeoutMs: 180_000, // a 7B model on this Mac needs ~20 s per job; leave headroom
  retries: 1, // when Ollama is unreachable
  invalidOutputRetries: 1, // when the answer is not valid JSON for the schema
} as const;
