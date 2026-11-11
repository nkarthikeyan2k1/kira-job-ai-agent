import { z } from "zod";
import { ApplicationStatusSchema } from "../enums.ts";

export const ApplicationSchema = z.object({
  id: z.number().int(),
  jobId: z.string().min(1),
  status: ApplicationStatusSchema,
  appliedAt: z.date().nullable(),
  nextFollowUpAt: z.date().nullable(),
  followUpCount: z.number().int().nonnegative(),
  resumePath: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Application = z.infer<typeof ApplicationSchema>;

// Append-only status history; analytics are computed from these rows.
export const ApplicationEventSchema = z.object({
  id: z.number().int(),
  applicationId: z.number().int(),
  fromStatus: ApplicationStatusSchema.nullable(), // null for the first event
  toStatus: ApplicationStatusSchema,
  at: z.date(),
  note: z.string().nullable(),
});
export type ApplicationEvent = z.infer<typeof ApplicationEventSchema>;
