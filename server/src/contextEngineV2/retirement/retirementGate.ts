import type { LegacyRetirementCaseResult, LegacyRetirementGateResult, RetirementCaseVerdict } from "./retirementTypes.js";
import { isDerivedLegacyRetirementCaseResult } from "./retirementCaseRunner.js";

const VERDICTS: readonly RetirementCaseVerdict[] = ["PASS", "ACCEPTABLE", "SAFE_FAIL", "CRITICAL_FAIL", "ENGINE_ERROR"];

export function evaluateLegacyRetirementGate(cases: readonly LegacyRetirementCaseResult[]): LegacyRetirementGateResult {
  if (!Array.isArray(cases) || cases.some((item) => !isDerivedLegacyRetirementCaseResult(item))) {
    throw new Error("retirement_gate_requires_observed_cases");
  }
  const totals = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<RetirementCaseVerdict, number>;
  for (const item of cases as readonly LegacyRetirementCaseResult[]) totals[item.verdict] += 1;
  const result: LegacyRetirementGateResult = {
    schemaVersion: 1,
    ready: false,
    totals,
    criticalFailures: totals.CRITICAL_FAIL,
    unsafeAutomaticAdoptions: cases.filter((item) => item.unsafeAutomaticAdoption).length,
    negativeConstraintViolations: cases.filter((item) => item.negativeConstraintViolation).length,
    restrictedEditableSelections: cases.filter((item) => item.restrictedEditableSelection).length,
    silentHybridSelections: cases.filter((item) => item.silentHybridSelection).length,
    modelPlannerUses: cases.filter((item) => item.modelPlannerUsed).length,
    deterministicReplayFailures: cases.filter((item) => !item.deterministicReplayEquivalent).length,
    unsafeAmbiguityOutcomes: cases.filter((item) => !item.semanticAmbiguityHandledSafely).length,
    unsupportedGroundedRoles: cases.filter((item) => !item.groundedRolesSupported).length,
  };
  result.ready = result.criticalFailures === 0 && totals.ENGINE_ERROR === 0 &&
    result.unsafeAutomaticAdoptions === 0 && result.negativeConstraintViolations === 0 &&
    result.restrictedEditableSelections === 0 && result.silentHybridSelections === 0 &&
    result.modelPlannerUses === 0 && result.deterministicReplayFailures === 0 &&
    result.unsafeAmbiguityOutcomes === 0 && result.unsupportedGroundedRoles === 0;
  return Object.freeze(structuredClone(result));
}
