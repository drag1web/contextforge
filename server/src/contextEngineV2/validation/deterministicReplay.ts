import { compareGoldenTraces } from "./goldenTraceSummary.js";
import type { GoldenComparison, GoldenTraceSummary } from "./validationTypes.js";

export interface DeterministicReplayResult {
  equivalent: boolean;
  comparisons: GoldenComparison[];
}

export function compareDeterministicReplays(
  summaries: readonly GoldenTraceSummary[],
): DeterministicReplayResult {
  if (summaries.length < 2) return { equivalent: true, comparisons: [] };
  const baseline = summaries[0]!;
  const comparisons = summaries.slice(1).map((summary) =>
    compareGoldenTraces(baseline, summary));
  return {
    equivalent: comparisons.every((comparison) => comparison.equivalent),
    comparisons,
  };
}
