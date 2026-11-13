import { ProfileSchema, parseRows, type Profile, type ProfileInput } from "@kira/shared";
import type pg from "pg";

/** The single profile row; null until `npm run profile:import` has run. */
export async function getProfile(db: pg.Pool): Promise<Profile | null> {
  const { rows } = await db.query("SELECT * FROM profile WHERE id = 1");
  return parseRows(ProfileSchema, rows)[0] ?? null;
}

/** Creates or replaces the single profile row. */
export async function saveProfile(db: pg.Pool, p: ProfileInput): Promise<void> {
  await db.query(
    `INSERT INTO profile (id, target_roles, skills, experience_years, seniority, target_seniority, title_keywords_include,
                          title_keywords_exclude, locations, remote_types, salary_min, salary_currency,
                          work_auth_countries, needs_sponsorship, notice_period_days, deal_breakers)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (id) DO UPDATE SET
       target_roles = EXCLUDED.target_roles, skills = EXCLUDED.skills, experience_years = EXCLUDED.experience_years,
       seniority = EXCLUDED.seniority, target_seniority = EXCLUDED.target_seniority,
       title_keywords_include = EXCLUDED.title_keywords_include, title_keywords_exclude = EXCLUDED.title_keywords_exclude,
       locations = EXCLUDED.locations, remote_types = EXCLUDED.remote_types, salary_min = EXCLUDED.salary_min,
       salary_currency = EXCLUDED.salary_currency, work_auth_countries = EXCLUDED.work_auth_countries,
       needs_sponsorship = EXCLUDED.needs_sponsorship, notice_period_days = EXCLUDED.notice_period_days,
       deal_breakers = EXCLUDED.deal_breakers`,
    [
      p.targetRoles, p.skills, p.experienceYears, p.seniority, p.targetSeniority, p.titleKeywordsInclude,
      p.titleKeywordsExclude, p.locations, p.remoteTypes, p.salaryMin, p.salaryCurrency,
      p.workAuthCountries, p.needsSponsorship, p.noticePeriodDays, p.dealBreakers,
    ],
  );
}
