import type { RequirementResult } from "@kira/shared";
import { describe, expect, it } from "vitest";
import { SCORING_CONFIG as config } from "../../config/scoring.ts";
import { computeFinalScore, computeLlmScore, summarizeBreakdown } from "./score.ts";

const r = (requirement: string, weight: "must" | "nice", status: "met" | "partial" | "missing"): RequirementResult => ({
  requirement,
  weight,
  status,
  evidence: null,
});

describe("computeLlmScore", () => {
  it("weights must-haves twice as much as nice-to-haves and counts partial as half", () => {
    // earned: must met 2 + must partial 1 + must missing 0 + nice met 1 = 4; possible: 2+2+2+1 = 7
    const breakdown = [r("A", "must", "met"), r("B", "must", "partial"), r("C", "must", "missing"), r("D", "nice", "met")];
    expect(computeLlmScore(breakdown, config)).toBe(57);
  });

  it("is 100 when everything is met, 0 when nothing is, and null when there is nothing to score", () => {
    expect(computeLlmScore([r("A", "must", "met"), r("B", "nice", "met")], config)).toBe(100);
    expect(computeLlmScore([r("A", "must", "missing")], config)).toBe(0);
    expect(computeLlmScore([], config)).toBeNull();
  });

  it("gives the same score for the same breakdown, whatever the order", () => {
    const breakdown = [r("A", "must", "met"), r("B", "nice", "missing"), r("C", "must", "partial")];
    expect(computeLlmScore([...breakdown].reverse(), config)).toBe(computeLlmScore(breakdown, config));
  });
});

describe("computeFinalScore", () => {
  it("mixes 40% similarity and 60% requirements", () => {
    expect(computeFinalScore(0.9, 80, config)).toBe(84); // 100 × (0.4·0.9 + 0.6·0.8)
    expect(computeFinalScore(0, 100, config)).toBe(60);
    expect(computeFinalScore(1, 0, config)).toBe(40);
  });

  it("lets one part carry the whole weight when the other is missing", () => {
    expect(computeFinalScore(null, 75, config)).toBe(75);
    expect(computeFinalScore(0.5, null, config)).toBe(50);
    expect(computeFinalScore(null, null, config)).toBeNull();
  });

  it("rounds to one decimal and stays within 0–100", () => {
    expect(computeFinalScore(0.333, 66, config)).toBe(52.9);
    expect(computeFinalScore(1, 100, config)).toBe(100);
  });
});

describe("summarizeBreakdown", () => {
  it("lists met and missing requirements and writes a one-line reason", () => {
    const summary = summarizeBreakdown([
      r("Node.js", "must", "met"),
      r("Kafka", "must", "partial"),
      r("Java and Spring Boot", "must", "missing"),
      r("AWS", "nice", "missing"),
    ]);
    expect(summary).toEqual({
      matchedSkills: ["Node.js", "Kafka"],
      missingSkills: ["Java and Spring Boot", "AWS"],
      reason: "Meets 1 of 3 must-haves (1 partly); missing: Java and Spring Boot.",
    });
  });

  it("shortens a long missing list", () => {
    const missing = ["A", "B", "C", "D", "E"].map((x) => r(x, "must", "missing"));
    expect(summarizeBreakdown(missing).reason).toBe("Meets 0 of 5 must-haves; missing: A; B; C (+2 more).");
    expect(summarizeBreakdown([r("X", "nice", "met")]).reason).toBe("No must-have requirements found.");
  });
});
