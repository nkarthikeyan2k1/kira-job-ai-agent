import type { z } from "zod";
import type { RawJob } from "./types.ts";

/**
 * Validates each posting on its own, so one malformed posting is skipped and
 * counted instead of failing the whole board. `toRawJob` may also return null
 * for a posting that is valid but unusable (e.g. no description).
 */
export function mapValidItems<S extends z.ZodType>(
  schema: S,
  items: readonly unknown[],
  toRawJob: (item: z.infer<S>) => RawJob | null,
): { jobs: RawJob[]; skipped: number } {
  const jobs: RawJob[] = [];
  let skipped = 0;
  for (const item of items) {
    const parsed = schema.safeParse(item);
    const job = parsed.success ? toRawJob(parsed.data) : null;
    if (job) jobs.push(job);
    else skipped++;
  }
  return { jobs, skipped };
}

/** ISO string or epoch milliseconds → Date; null when absent or unparseable. */
export function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
