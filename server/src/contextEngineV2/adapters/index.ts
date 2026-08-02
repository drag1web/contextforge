export {
  LegacyInventorySnapshotError,
  createLegacyInventorySnapshotPort,
} from "./legacyInventory/index.js";
export type {
  LegacyInventorySnapshotIssue,
  LegacyInventorySnapshotPortOptions,
} from "./legacyInventory/index.js";
export {
  FactExtractionConflictError,
  createFactExtractorRegistry,
  createManifestFactExtractor,
  createTypeScriptJavaScriptFactExtractor,
} from "./extraction/index.js";
export {
  KnowledgeGraphStoreError,
  createInMemoryKnowledgeGraphStore,
} from "./knowledge/index.js";
export type { KnowledgeGraphStoreErrorCode } from "./knowledge/index.js";
export {
  CompatibilityComparisonError,
  LegacyProjectionError,
  createLegacyTaskFileSelectionProjection,
  createOfflineCompatibilityComparison,
} from "./legacySelection/index.js";
export {
  createLiveRepositoryAdapter,
  createLiveShadowRepositoryAdapter,
} from "./liveShadow/index.js";
export type {
  LiveRepositoryAdapterInput,
  LiveShadowRepositoryAdapterInput,
} from "./liveShadow/index.js";
export type {
  ComparisonOutcome,
  CompatibilityComparisonSummary,
  CompatibilityEvaluationBasis,
  EvidenceComparison,
  LegacyProjectionDiagnostic,
  LegacyProjectionErrorCode,
  LegacyProjectionExclusion,
  LegacyProjectionFileTrace,
  LegacyProjectionOptions,
  LegacyProjectionResult,
  LegacySelectionSummary,
  LegacyTaskFileSelectionProjection,
  OfflineCompatibilityComparison,
  OfflineCompatibilityComparisonInput,
  SafetyComparison,
  SelectionOverlap,
  V2ProjectionSummary,
} from "./legacySelection/index.js";
