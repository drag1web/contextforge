export {
  InvariantViolationError,
  assertEvidenceSnapshotConsistency,
  assertFactSnapshotConsistency,
  assertFindingEvidenceConsistency,
  assertValidInvestigationRequest,
  isJsonSafeValue,
  validateInvestigationRequest,
  validateRepositorySnapshot,
} from "./invariant.js";
export { assertRepositoryEntitySnapshotConsistency } from "./knowledgeGraphInvariant.js";
export {
  InvestigationDomainError,
} from "./investigationDomainSupport.js";
export type {
  InvestigationDomainErrorCode,
} from "./investigationDomainSupport.js";
export { createEvidenceLedger } from "./evidenceLedger.js";
export type { EvidenceLedger } from "./evidenceLedger.js";
export { evaluateEvidenceRequirement } from "./evidenceRequirementEvaluator.js";
export type {
  EvidenceRequirementEvaluation,
  EvidenceRequirementEvaluationInput,
} from "./evidenceRequirementEvaluator.js";
export { evaluateClaim } from "./claimEvaluator.js";
export type {
  ClaimEvaluation,
  ClaimEvaluationInput,
} from "./claimEvaluator.js";
export { createHypothesisLedger } from "./hypothesisLedger.js";
export type {
  HypothesisClaimEvaluationInput,
  HypothesisLedger,
  HypothesisReopenInput,
  HypothesisTransitionInput,
} from "./hypothesisLedger.js";
export {
  createContradictionRegistry,
  detectDeterministicContradictions,
} from "./contradictionRegistry.js";
export type {
  ContradictionDetection,
  ContradictionRegistry,
} from "./contradictionRegistry.js";
export { createKnowledgeGapRegistry } from "./knowledgeGapRegistry.js";
export type { KnowledgeGapRegistry } from "./knowledgeGapRegistry.js";
export {
  applyOperationCost,
  canFitOperationCost,
  createInvestigationBudgetState,
  snapshotInvestigationBudget,
} from "./investigationBudget.js";
export { calculateInvestigationCoverage } from "./investigationCoverage.js";
export type { InvestigationCoverageInput } from "./investigationCoverage.js";
export { evaluateFindingEligibility } from "./findingEligibility.js";
export type { FindingEligibilityEvaluation } from "./findingEligibility.js";
export { createStopPolicy } from "./stopPolicy.js";
export type { StopDecision, StopPolicy, StopPolicyState } from "./stopPolicy.js";
export type {
  ContractValidationIssue,
  ContractValidationResult,
} from "./validationTypes.js";
