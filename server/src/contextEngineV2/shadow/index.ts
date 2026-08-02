export { normalizeContextEngineMode } from "./shadowMode.js";
export { runContextEngineShadowSidecar } from "./shadowSidecar.js";
export {
  closeContextEngineShadowExecutionTracker,
  createContextEngineShadowExecutionTracker,
  defaultContextEngineShadowExecutionTracker,
  settleContextEngineShadowExecution,
} from "./shadowDeadline.js";
export {
  assertContextEngineShadowInputEquivalent,
  deriveShadowExplicitTargets,
  deriveShadowNegativeConstraints,
  prepareContextEngineShadowInput,
} from "./shadowInputPreparation.js";
export type { PrepareContextEngineShadowInput, ShadowStructuredTarget } from "./shadowInputPreparation.js";
export { createContextEngineShadowHistory } from "./shadowDiagnostics.js";
export { createContextEngineShadowDiagnosticsWriter } from "./shadowDiagnosticsWriter.js";
export {
  runLiveContextEngineShadow,
} from "./shadowExecutionService.js";
export {
  assertContextEngineShadowExecutionBasis,
  contextEngineShadowConfigurationFingerprint,
  createContextEngineShadowExecutionBasis,
  DEFAULT_CONTEXT_ENGINE_SHADOW_POLICY,
  normalizeContextEngineShadowExecutionBasis,
} from "./shadowExecutionBasis.js";
export { validateContextEngineShadowComparison } from "./shadowTypesInvariant.js";
export { createContextEngineShadowPreparationFailure } from "./shadowComparison.js";
export type * from "./shadowTypes.js";
