import { z } from "zod";
import { AtsTypeSchema } from "../enums.ts";

export const CompanySchema = z.object({
  id: z.string().min(1), // slug from companies.json, e.g. "stripe"
  name: z.string().min(1),
  ats: AtsTypeSchema,
  atsKey: z.string().min(1), // board token (Greenhouse), site (Lever), org (Ashby), tenant (Workday)
  // Extra per-ATS settings (e.g. Workday host + site). The per-ATS shape is
  // defined together with the fetcher that reads it.
  atsConfig: z.record(z.string(), z.unknown()),
  careersUrl: z.url(),
  enabled: z.boolean(),
  tier: z.number().int().min(1).max(3), // 1 = top target, 3 = backup; ordering only
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Company = z.infer<typeof CompanySchema>;
