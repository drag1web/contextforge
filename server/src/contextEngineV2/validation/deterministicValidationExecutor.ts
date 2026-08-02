import { createHash } from "node:crypto";

import {
  createInvestigationRunner,
  type DeterministicPlannerPolicy,
  type InvestigationRunnerDependencies,
} from "../application/index.js";
import type { InvestigationId } from "../contracts/index.js";
import type {
  ValidationInvestigationExecutor,
  ValidationExecutionInput,
} from "./validationTypes.js";

const trustedDeterministicExecutors = new WeakSet<ValidationInvestigationExecutor>();

export interface DeterministicValidationExecutorDependencies
  extends InvestigationRunnerDependencies {
  plannerPolicy?: DeterministicPlannerPolicy;
}

const DEFAULT_PLANNER_POLICY: DeterministicPlannerPolicy = {
  maxOperationsPerRound: 1,
  searchResultLimit: 20,
  maxFailedOperationRetries: 1,
};

function investigationId(input: ValidationExecutionInput): InvestigationId {
  const digest = createHash("sha256")
    .update([
      input.snapshot.id,
      input.validationCase.id,
      input.validationCase.purpose,
      input.request.requestId,
    ].join("\0"), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `validation-investigation-${digest}` as InvestigationId;
}

export function createDeterministicValidationInvestigationExecutor(
  dependencies: DeterministicValidationExecutorDependencies,
): ValidationInvestigationExecutor {
  const runner = createInvestigationRunner({
    clock: dependencies.clock,
    cancellation: dependencies.cancellation,
    repositoryReader: dependencies.repositoryReader,
    repositorySearch: dependencies.repositorySearch,
    factExtractor: dependencies.factExtractor,
    graphStore: dependencies.graphStore,
    ...(dependencies.planner === undefined ? {} : { planner: dependencies.planner }),
  });
  const plannerPolicy = Object.freeze({
    ...(dependencies.plannerPolicy ?? DEFAULT_PLANNER_POLICY),
  });
  const executor = Object.freeze<ValidationInvestigationExecutor>({
    executionMarker: "real_engine",
    async execute(input) {
      const result = await runner.run({
        investigationId: investigationId(input),
        snapshot: input.snapshot,
        purpose: input.validationCase.purpose,
        request: input.request,
        questions: [],
        claims: [],
        hypotheses: [],
        entities: [],
        facts: [],
        evidence: [],
        findings: [],
        contradictions: [],
        knowledgeGaps: [],
        operationCandidates: [],
        budget: input.budget,
        plannerPolicy: { ...plannerPolicy },
      });
      return { result };
    },
  });
  trustedDeterministicExecutors.add(executor);
  return executor;
}

// Internal trust boundary: a public marker string is descriptive only and never
// establishes that an executor was constructed around the real CE2 runner.
export function isTrustedDeterministicValidationExecutor(
  executor: ValidationInvestigationExecutor,
): boolean {
  return trustedDeterministicExecutors.has(executor);
}
