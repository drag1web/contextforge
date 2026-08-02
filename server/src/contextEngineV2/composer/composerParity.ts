import type {
  ContextComposerComparisonView,
  ContextComposerParityAggregate,
} from "./composerTypes.js";
import { validateContextComposerComparisonView } from "./composerInvariant.js";

function pathSetEqual(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function aggregateContextComposerComparisons(
  comparisons: readonly ContextComposerComparisonView[],
): ContextComposerParityAggregate {
  const ordered = comparisons.map(validateContextComposerComparisonView).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return Object.freeze({
    comparisonCount: ordered.length,
    exactEditableAgreementCount: ordered.filter((item) =>
      item.legacyOnlyEditablePaths.length === 0 &&
      item.v2OnlyEditablePaths.length === 0 &&
      pathSetEqual(item.exactEditablePaths, item.exactEditablePaths)).length,
    safeBlockAgreementCount: ordered.filter((item) => item.safeBlockAgreement).length,
    explicitTargetAgreementCount: ordered.filter((item) => item.explicitTargetDisagreements.length === 0).length,
    insufficientEvaluationDataCount: ordered.filter((item) => item.outcome === "insufficient_evaluation_data").length,
  });
}
