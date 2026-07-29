export type * from "./contracts/index.js";
export {
  ContextEngineNotImplementedError,
  InvalidInvestigationRequestError,
  createContextEngineV2,
} from "./application/index.js";
export type {
  ContextEngineServiceDependencies,
  ContextEngineV2,
} from "./application/index.js";
export {
  FactExtractionConflictError,
  KnowledgeGraphStoreError,
  LegacyInventorySnapshotError,
  createFactExtractorRegistry,
  createInMemoryKnowledgeGraphStore,
  createLegacyInventorySnapshotPort,
  createManifestFactExtractor,
  createTypeScriptJavaScriptFactExtractor,
} from "./adapters/index.js";
export type {
  KnowledgeGraphStoreErrorCode,
  LegacyInventorySnapshotIssue,
  LegacyInventorySnapshotPortOptions,
} from "./adapters/index.js";
export type {
  ClockPort,
  ExtractionLimitation,
  ExtractionResult,
  ExtractorInput,
  FactExtractorPort,
  FactQuery,
  KnowledgeEdge,
  KnowledgeGraphStorePort,
  KnowledgeTraceExport,
  NeighborQuery,
} from "./ports/index.js";
export {
  InvestigationDomainError,
  applyOperationCost,
  calculateInvestigationCoverage,
  canFitOperationCost,
  createContradictionRegistry,
  createEvidenceLedger,
  createHypothesisLedger,
  createInvestigationBudgetState,
  createKnowledgeGapRegistry,
  createStopPolicy,
  detectDeterministicContradictions,
  evaluateClaim,
  evaluateEvidenceRequirement,
  evaluateFindingEligibility,
  snapshotInvestigationBudget,
} from "./domain/index.js";
export type {
  ClaimEvaluation,
  ClaimEvaluationInput,
  ContradictionDetection,
  ContradictionRegistry,
  EvidenceLedger,
  EvidenceRequirementEvaluation,
  EvidenceRequirementEvaluationInput,
  FindingEligibilityEvaluation,
  HypothesisClaimEvaluationInput,
  HypothesisLedger,
  HypothesisReopenInput,
  HypothesisTransitionInput,
  InvestigationCoverageInput,
  InvestigationDomainErrorCode,
  KnowledgeGapRegistry,
  StopDecision,
  StopPolicy,
  StopPolicyState,
} from "./domain/index.js";
