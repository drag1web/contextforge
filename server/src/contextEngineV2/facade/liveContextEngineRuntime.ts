import {
  createInvestigationRunner,
} from "../application/index.js";
import type {
  InvestigationRunnerInput,
  InvestigationRunnerResult,
} from "../application/index.js";
import {
  createFactExtractorRegistry,
  createInMemoryKnowledgeGraphStore,
  createLiveRepositoryAdapter,
  createManifestFactExtractor,
  createTypeScriptJavaScriptFactExtractor,
} from "../adapters/index.js";
import type { LiveRepositoryAdapterInput } from "../adapters/index.js";
import type { ClockPort } from "../ports/index.js";
import type { ModelPlannerPort } from "../ports/index.js";
import type {
  ContextEnginePlannerMode,
  ModelPlannerObservation,
} from "../contracts/index.js";
import {
  createConfiguredAiModelPlannerAdapter,
} from "../adapters/modelPlanner/index.js";
import {
  createModelAssistedInvestigationPlanner,
  DEFAULT_MODEL_PLANNER_POLICY,
  normalizeContextEnginePlannerMode,
  type ModelPlannerPolicy,
  type ModelPlannerRequestTracker,
} from "../planner/index.js";

export interface LiveContextEngineExecutionInput {
  projectRoot: string;
  inventory: LiveRepositoryAdapterInput["inventory"];
  snapshot: LiveRepositoryAdapterInput["snapshot"];
  negativeConstraints: LiveRepositoryAdapterInput["negativeConstraints"];
  clock: ClockPort;
  abortSignal: AbortSignal;
  runnerInput: InvestigationRunnerInput;
  plannerMode?: ContextEnginePlannerMode;
  modelPlanner?: ModelPlannerPort;
  modelPlannerPolicy?: ModelPlannerPolicy;
  modelPlannerTracker?: ModelPlannerRequestTracker;
  observeModelPlanner?: (observation: ModelPlannerObservation) => void;
}

/**
 * Neutral production assembly for a request-local CE2 investigation.
 * It owns no mode, persistence, diagnostics, Composer, or shadow policy.
 */
export function createLiveContextEngineExecution(
  input: LiveContextEngineExecutionInput,
): Promise<InvestigationRunnerResult> {
  const cancellation = {
    isCancellationRequested: () => input.abortSignal.aborted,
  };
  const repository = createLiveRepositoryAdapter({
    projectRoot: input.projectRoot,
    inventory: input.inventory,
    snapshot: input.snapshot,
    negativeConstraints: input.negativeConstraints,
    cancellation,
    abortSignal: input.abortSignal,
  });
  const plannerMode = normalizeContextEnginePlannerMode(input.plannerMode);
  const modelPolicy = input.modelPlannerPolicy ?? DEFAULT_MODEL_PLANNER_POLICY;
  const actionPlanner = plannerMode === "model_assisted"
    ? createModelAssistedInvestigationPlanner({
        model: input.modelPlanner ?? createConfiguredAiModelPlannerAdapter({
          timeoutMs: modelPolicy.maxModelPlannerWallTimeMs,
          maxOutputBytes: modelPolicy.maxModelOutputBytes,
          maxProviderResponseBytes: modelPolicy.maxProviderResponseEnvelopeBytes,
        }),
        policy: modelPolicy,
        requestId: input.runnerInput.investigationId,
        signal: input.abortSignal,
        ...(input.modelPlannerTracker ? { tracker: input.modelPlannerTracker } : {}),
        ...(input.observeModelPlanner ? { observe: input.observeModelPlanner } : {}),
      })
    : undefined;
  const runner = createInvestigationRunner({
    clock: input.clock,
    cancellation,
    repositoryReader: repository.reader,
    repositorySearch: repository.search,
    factExtractor: createFactExtractorRegistry([
      createTypeScriptJavaScriptFactExtractor(input.clock),
      createManifestFactExtractor(input.clock),
    ]),
    graphStore: createInMemoryKnowledgeGraphStore(),
    ...(actionPlanner ? { actionPlanner, plannerSignal: input.abortSignal } : {}),
  });
  return runner.run(input.runnerInput);
}
