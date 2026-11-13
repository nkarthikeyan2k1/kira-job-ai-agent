import { describe, expect, it } from "vitest";
import { HARD_FILTER_CONFIG as config } from "../../config/scoring.ts";
import { seniorityFromTitle, yearsMinFromDescription } from "./job-attributes.ts";

describe("seniorityFromTitle", () => {
  it.each([
    ["Senior Backend Engineer", "senior"],
    ["Sr. Design Engineer - Under Body Structures", "senior"],
    ["Software Engineer III", "senior"],
    ["Software Engineer II", "mid"],
    ["Staff Engineer, Core Infrastructure", "staff"],
    ["Lead Engineer - Wheels (Passenger Car)", "staff"],
    ["Principal Engineer / Architect - System Health", "principal"],
    ["Engineering Manager, Accounting Products", "manager"],
    ["Senior Engineering Manager", "manager"],
    ["Associate Director, Risk", "manager"],
    ["Associate Software Developer", "junior"],
    ["Software Engineering Intern", "intern"],
    ["Software Engineer, New Grad", "intern"],
    ["Backend Engineer, Payments", null],
    ["Full Stack Engineer, Enterprise Engineering", null],
  ])("%s → %s", (title, level) => {
    expect(seniorityFromTitle(title, config)).toBe(level);
  });
});

describe("yearsMinFromDescription", () => {
  it.each([
    ["10+ years of backend and/or full-stack experience", 10],
    ["2–12+ years of industry software engineering experience", 2], // a range counts by its lower bound
    ["2-5+ years of industry software engineering", 2],
    ["Experience: 8-12 years", 8],
    ["You have a minimum 5 years building APIs", 5],
    ["At least 3 yrs with React", 3],
    ["3 to 5 years' experience in fintech", 3],
    ["4 years experience required", 4],
  ])("%s → %i", (text, years) => {
    expect(yearsMinFromDescription(text, config)).toBe(years);
  });

  it("takes the largest requirement when there are several", () => {
    expect(yearsMinFromDescription("5+ years of backend experience and 2+ years leading teams.", config)).toBe(5);
  });

  it("ignores years that are not an experience requirement", () => {
    for (const text of [
      "Stripe has grown for 12 years.",
      "A company with over 150 years of history",
      "We were founded 10 years ago",
      "No years mentioned at all",
    ]) {
      expect(yearsMinFromDescription(text, config), text).toBeNull();
    }
  });
});
