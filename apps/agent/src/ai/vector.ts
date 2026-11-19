// An embedding is a list of numbers (768 for nomic-embed-text) that places a
// text in "meaning space": texts about similar things get nearby vectors.

/** Checks a vector from the model before it is stored: right length, only finite numbers. */
export function assertVector(vector: unknown, dimensions: number): asserts vector is number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new Error(`Expected a ${dimensions}-dimension vector, got ${Array.isArray(vector) ? vector.length : typeof vector}`);
  }
  if (!vector.every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error("Vector contains a non-finite number");
}

/** pgvector's text form, e.g. "[0.1,0.2,0.3]", for a `$1::vector` parameter. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * Cosine similarity: the cosine of the angle between two vectors. 1 = same
 * direction (same meaning), 0 = unrelated. In SQL, pgvector's `<=>` gives the
 * cosine *distance*, so similarity = 1 - (a <=> b).
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! ** 2;
    normB += b[i]! ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}
