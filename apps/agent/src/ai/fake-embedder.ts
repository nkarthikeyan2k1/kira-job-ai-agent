import { createHash } from "node:crypto";
import type { EmbedTask } from "../../config/llm-routing.ts";
import type { LlmClient } from "./llm-client.ts";

/**
 * A stand-in for the embedding model in tests: each word adds weight to one
 * of 768 slots (picked by hashing the word), then the vector is scaled to
 * length 1. Texts that share words get similar vectors, which is enough to
 * test the storage and retrieval code without Ollama.
 */
export function fakeVector(text: string): number[] {
  const vector = new Array<number>(768).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    vector[createHash("md5").update(word).digest().readUInt32BE(0) % 768]! += 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((x) => x / length);
}

/** Embeds with fakeVector. Generation is not faked here: tests that need it override generateJson. */
export function fakeLlmClient(): LlmClient & { calls: { task: EmbedTask; texts: readonly string[] }[] } {
  const calls: { task: EmbedTask; texts: readonly string[] }[] = [];
  return {
    calls,
    async embed(task, texts) {
      calls.push({ task, texts });
      return texts.map(fakeVector);
    },
    async generateJson() {
      throw new Error("fakeLlmClient: generateJson is not faked; pass a client that implements it");
    },
  };
}
