import { describe, expect, it } from "vitest";
import { evalMetrics, ranks } from "./eval-metrics.ts";

describe("ranks", () => {
  it("gives tied values the average of their ranks", () => {
    expect(ranks([10, 30, 20, 30])).toEqual([1, 3.5, 2, 3.5]);
  });
});

describe("evalMetrics", () => {
  const rows = [
    { wouldApply: true, myScore: 90, finalScore: 85 }, // shortlisted, yes
    { wouldApply: false, myScore: 40, finalScore: 75 }, // shortlisted, no
    { wouldApply: true, myScore: 70, finalScore: 60 }, // missed
    { wouldApply: false, myScore: 20, finalScore: 30 },
    { wouldApply: true, myScore: 80, finalScore: null }, // could not be scored: left out
  ];

  it("reports precision of the shortlist, recall of my yes jobs, rank agreement and error", () => {
    expect(evalMetrics(rows, 70)).toEqual({
      jobs: 4,
      shortlisted: 2,
      precision: 0.5,
      recall: 0.5,
      spearman: 0.8, // orders: kira 85,75,60,30 vs me 90,40,70,20
      meanAbsError: 15, // (5 + 35 + 10 + 10) / 4
    });
  });

  it("returns null where a metric is undefined", () => {
    expect(evalMetrics([{ wouldApply: false, myScore: 10, finalScore: 20 }], 70)).toEqual({
      jobs: 1,
      shortlisted: 0,
      precision: null,
      recall: null,
      spearman: null,
      meanAbsError: 10,
    });
  });
});
