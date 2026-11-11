import { z } from "zod";

export const FetchRunSchema = z.object({
  id: z.number().int(),
  companyId: z.string().min(1),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  jobsSeen: z.number().int().nonnegative(),
  jobsNew: z.number().int().nonnegative(),
  jobsClosed: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type FetchRun = z.infer<typeof FetchRunSchema>;
