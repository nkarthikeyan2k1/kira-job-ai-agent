// How well Kira's scores agree with my own judgement on hand-labelled jobs.

export interface EvalRow {
  wouldApply: boolean; // my label
  myScore: number; // my 0–100
  finalScore: number | null; // Kira's
}

export interface EvalMetrics {
  jobs: number; // labelled jobs Kira could score
  shortlisted: number; // Kira's score ≥ threshold
  /** Of the jobs Kira shortlisted, the share I would apply to. Null when it shortlisted none. */
  precision: number | null;
  /** Of the jobs I would apply to, the share Kira shortlisted. Null when I said yes to none. */
  recall: number | null;
  /** Rank correlation between Kira's score and mine (-1…1): do they order jobs the same way? */
  spearman: number | null;
  meanAbsError: number | null; // average |Kira − me| in points
}

/** Ranks 1…n; tied values share the average of their ranks. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) result[order[k]!.index] = rank;
    i = j + 1;
  }
  return result;
}

function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length;
  if (n < 2) return null;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i]! - meanA) * (b[i]! - meanB);
    varA += (a[i]! - meanA) ** 2;
    varB += (b[i]! - meanB) ** 2;
  }
  return varA === 0 || varB === 0 ? null : cov / Math.sqrt(varA * varB);
}

export function evalMetrics(rows: readonly EvalRow[], threshold: number): EvalMetrics {
  const scored = rows.filter((row): row is EvalRow & { finalScore: number } => row.finalScore !== null);
  const shortlisted = scored.filter((row) => row.finalScore >= threshold);
  const yes = scored.filter((row) => row.wouldApply);
  const round = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);

  return {
    jobs: scored.length,
    shortlisted: shortlisted.length,
    precision: round(shortlisted.length === 0 ? null : shortlisted.filter((row) => row.wouldApply).length / shortlisted.length),
    recall: round(yes.length === 0 ? null : yes.filter((row) => row.finalScore >= threshold).length / yes.length),
    spearman: round(pearson(ranks(scored.map((row) => row.finalScore)), ranks(scored.map((row) => row.myScore)))),
    meanAbsError: round(scored.length === 0 ? null : scored.reduce((sum, row) => sum + Math.abs(row.finalScore - row.myScore), 0) / scored.length),
  };
}
