import { describe, expect, it } from "vitest";
import { FETCHERS } from "../fetchers/registry.ts";
import { CompaniesFileSchema, loadCompaniesConfig } from "./companies.ts";

const entry = { id: "acme", name: "Acme", ats: "greenhouse", atsKey: "acme", careersUrl: "https://example.com/careers" };

describe("companies config", () => {
  it("accepts the checked-in companies.json, and every enabled company has a fetcher", async () => {
    const companies = await loadCompaniesConfig();

    expect(companies.length).toBeGreaterThan(0);
    for (const company of companies.filter((c) => c.enabled)) expect(FETCHERS[company.ats], company.id).toBeDefined();
  });

  it("applies defaults", () => {
    expect(CompaniesFileSchema.parse([entry])[0]).toMatchObject({ enabled: true, tier: 2, atsConfig: {} });
  });

  it("rejects an atsKey that could change the request URL", () => {
    for (const atsKey of ["../admin", "acme/jobs", "acme?x=1", "acme.evil.com", ""]) {
      expect(CompaniesFileSchema.safeParse([{ ...entry, atsKey }]).success, atsKey).toBe(false);
    }
  });

  it("rejects duplicate ids, unknown ATS types and bad tiers", () => {
    expect(CompaniesFileSchema.safeParse([entry, entry]).success).toBe(false);
    expect(CompaniesFileSchema.safeParse([{ ...entry, ats: "linkedin" }]).success).toBe(false);
    expect(CompaniesFileSchema.safeParse([{ ...entry, tier: 5 }]).success).toBe(false);
  });
});
