import type { RequirementResult } from "@kira/shared";
import { describe, expect, it } from "vitest";
import { normalizeForQuote, verifyRequirements } from "./verify.ts";

const RESUME = `Simply Algo Fintech
- Handled 15L+ daily requests by building an event-driven Node.js microservice, reducing database load by 80%.
- Reduced broker onboarding time by 60% by designing an Order–Facade microservice.
Skills: TypeScript, React.js, PostgreSQL, Redis`;

const item = (overrides: Partial<RequirementResult> = {}): RequirementResult => ({
  requirement: "Node.js microservices",
  weight: "must",
  status: "met",
  evidence: "Handled 15L+ daily requests by building an event-driven Node.js microservice",
  ...overrides,
});

describe("normalizeForQuote", () => {
  it("ignores case, bullets, dashes, curly quotes and spacing", () => {
    expect(normalizeForQuote("- Order–Facade  microservice’s\n  API")).toBe("order-facade microservice's api");
  });
});

describe("verifyRequirements", () => {
  it("keeps a real quote, even with different case, spacing or a leading bullet", () => {
    const { results, stats } = verifyRequirements(
      [item(), item({ requirement: "Order facade", evidence: "- reduced broker onboarding time by 60%  by designing an Order-Facade microservice" })],
      RESUME,
    );
    expect(results.map((r) => [r.status, r.evidence !== null])).toEqual([["met", true], ["met", true]]);
    expect(stats).toEqual({ quotesDropped: 0, downgraded: 0, reweighted: 0 });
  });

  it("drops a quote that is not in the resume and downgrades 'met' without evidence to 'partial'", () => {
    const { results, stats } = verifyRequirements([item({ evidence: "Led a team of 12 engineers building Kafka pipelines" })], RESUME);

    expect(results[0]).toMatchObject({ status: "partial", evidence: null });
    expect(stats).toEqual({ quotesDropped: 1, downgraded: 1, reweighted: 0 });
  });

  it("leaves 'partial' and 'missing' without evidence as they are", () => {
    const { results } = verifyRequirements(
      [item({ requirement: "Kafka", status: "partial", evidence: null }), item({ requirement: "Java", status: "missing", evidence: null })],
      RESUME,
    );
    expect(results.map((r) => r.status)).toEqual(["partial", "missing"]);
  });

  it("makes a requirement worded as optional a nice-to-have", () => {
    const { results, stats } = verifyRequirements(
      [
        item({ requirement: "Node.js is a plus" }),
        item({ requirement: "Experience with Kafka preferred", status: "missing", evidence: null }),
        item({ requirement: "Good to have: AWS", status: "missing", evidence: null }),
        item({ requirement: "Strong SQL skills", status: "missing", evidence: null }),
      ],
      RESUME,
    );
    expect(results.map((r) => r.weight)).toEqual(["nice", "nice", "nice", "must"]);
    expect(stats.reweighted).toBe(3);
  });

  it("keeps a duplicate requirement once", () => {
    const { results } = verifyRequirements([item(), item({ requirement: " node.js  MICROSERVICES " })], RESUME);
    expect(results).toHaveLength(1);
  });
});
