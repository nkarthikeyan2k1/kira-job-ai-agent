import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AtsTypeSchema } from "@kira/shared";
import { z } from "zod";

const COMPANIES_FILE = fileURLToPath(new URL("../../config/companies.json", import.meta.url));

export const CompanyConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  name: z.string().min(1),
  ats: AtsTypeSchema,
  // Goes into a URL path or hostname, so the alphabet is restricted.
  atsKey: z.string().regex(/^[A-Za-z0-9_-]+$/, "letters, digits, dash or underscore"),
  atsConfig: z.record(z.string(), z.unknown()).default({}),
  careersUrl: z.url(),
  enabled: z.boolean().default(true),
  tier: z.number().int().min(1).max(3).default(2),
});
export type CompanyConfig = z.infer<typeof CompanyConfigSchema>;

export const CompaniesFileSchema = z.array(CompanyConfigSchema).superRefine((companies, ctx) => {
  const seen = new Set<string>();
  companies.forEach((company, index) => {
    if (seen.has(company.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: `duplicate company id "${company.id}"` });
    seen.add(company.id);
  });
});

/** Reads and validates config/companies.json; throws with a readable message when it is wrong. */
export async function loadCompaniesConfig(file: string = COMPANIES_FILE): Promise<CompanyConfig[]> {
  const parsed = CompaniesFileSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) throw new Error(`Invalid ${file}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
