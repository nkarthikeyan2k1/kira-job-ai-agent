import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// apps/agent/evals/labeled.json: jobs I judged by hand. No personal data, so it is committed.
export const LABELS_FILE = fileURLToPath(new URL("../../evals/labeled.json", import.meta.url));

export const LabelSchema = z.object({
  jobId: z.string().min(1),
  company: z.string(),
  title: z.string(),
  wouldApply: z.boolean(),
  myScore: z.number().int().min(0).max(100),
  labeledAt: z.string(),
});
export type Label = z.infer<typeof LabelSchema>;

export async function readLabels(file: string = LABELS_FILE): Promise<Label[]> {
  const raw = await readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "[]";
    throw err;
  });
  return z.array(LabelSchema).parse(JSON.parse(raw));
}

export async function writeLabels(labels: readonly Label[], file: string = LABELS_FILE): Promise<void> {
  await writeFile(file, `${JSON.stringify(labels, null, 2)}\n`);
}
