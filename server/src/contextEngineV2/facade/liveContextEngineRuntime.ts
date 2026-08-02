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

export interface LiveContextEngineExecutionInput {
  projectRoot: string;
  inventory: LiveRepositoryAdapterInput["inventory"];
  snapshot: LiveRepositoryAdapterInput["snapshot"];
  negativeConstraints: LiveRepositoryAdapterInput["negativeConstraints"];
  clock: ClockPort;
  abortSignal: AbortSignal;
  runnerInput: InvestigationRunnerInput;
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
  });
  return runner.run(input.runnerInput);
}
