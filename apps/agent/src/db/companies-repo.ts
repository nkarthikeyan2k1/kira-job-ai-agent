import { CompanySchema, parseRows, type Company } from "@kira/shared";
import type pg from "pg";
import type { CompanyConfig } from "../config/companies.ts";

/**
 * Makes the companies table match companies.json: upserts every entry and
 * disables (never deletes: jobs reference them) companies no longer listed.
 * Returns the enabled companies.
 */
export async function syncCompanies(db: pg.Pool, configs: readonly CompanyConfig[]): Promise<Company[]> {
  for (const c of configs) {
    await db.query(
      `INSERT INTO companies (id, name, ats, ats_key, ats_config, careers_url, enabled, tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, ats = EXCLUDED.ats, ats_key = EXCLUDED.ats_key, ats_config = EXCLUDED.ats_config,
         careers_url = EXCLUDED.careers_url, enabled = EXCLUDED.enabled, tier = EXCLUDED.tier`,
      [c.id, c.name, c.ats, c.atsKey, JSON.stringify(c.atsConfig), c.careersUrl, c.enabled, c.tier],
    );
  }
  await db.query("UPDATE companies SET enabled = false WHERE enabled AND id <> ALL($1::text[])", [configs.map((c) => c.id)]);

  const { rows } = await db.query("SELECT * FROM companies WHERE enabled ORDER BY tier, id");
  return parseRows(CompanySchema, rows);
}
