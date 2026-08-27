import type {
  ContextEnginePlannerMode,
  ModelPlannerFallbackReason,
  ModelPlannerObservation,
} from "../contracts/index.js";
import { createHash } from "node:crypto";
import {
  createDeterministicInvestigationPlanner,
  type DeterministicInvestigationPlanner,
  type InvestigationPlanner,
  type DeterministicPlannerState,
} from "../application/index.js";
import type { ModelPlannerPort } from "../ports/index.js";
import { ModelPlannerPortError } from "../ports/modelPlannerPort.js";
import { isSecretLikeSemanticLiteral } from "../domain/semanticLiteralSafety.js";
import { createModelPlannerContext } from "./plannerContext.js";
import {
  createValidatedModelInvestigationPlan,
  ModelPlannerProposalError,
  validateModelPlannerProposal,
} from "./plannerProposalInvariant.js";
import {
  defaultModelPlannerRequestTracker,
  type ModelPlannerRequestTracker,
} from "./modelPlannerLifecycle.js";
import {
  DEFAULT_MODEL_PLANNER_POLICY,
  normalizeModelPlannerPolicy,
  type ModelPlannerPolicy,
} from "./plannerPolicy.js";

export interface ModelAssistedInvestigationPlannerOptions {
  model: ModelPlannerPort;
  deterministic?: DeterministicInvestigationPlanner;
  policy?: ModelPlannerPolicy;
  tracker?: ModelPlannerRequestTracker;
  requestId: string;
  signal?: AbortSignal;
  clock?: { monotonicMs(): number };
  observe?: (observation: ModelPlannerObservation) => void;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    /^[a-z0-9][a-z0-9._:-]{0,80}$/iu.test(value) &&
    !isSecretLikeSemanticLiteral(value)
    ? value
    : null;
}

function fallbackCode(error: unknown): ModelPlannerFallbackReason {
  if (error instanceof ModelPlannerProposalError) return error.code;
  if (error instanceof ModelPlannerPortError) return error.code;
  return "provider_error";
}

function observation(input: Omit<ModelPlannerObservation, "schemaVersion">): ModelPlannerObservation {
  return Object.freeze({
    schemaVersion: 1,
    ...input,
    requestId: `planner-sha256:${createHash("sha256").update(input.requestId, "utf8").digest("hex")}`,
    providerIdentifier: safeIdentifier(input.providerIdentifier),
    modelIdentifier: safeIdentifier(input.modelIdentifier),
    durationMs: Number.isFinite(input.durationMs) && input.durationMs >= 0
      ? input.durationMs
      : 0,
    inputBytes: Number.isSafeInteger(input.inputBytes) && input.inputBytes >= 0
      ? input.inputBytes
      : 0,
    outputBytes: Number.isSafeInteger(input.outputBytes) && input.outputBytes >= 0
      ? input.outputBytes
      : 0,
  });
}

export function createDeterministicPlannerBoundary(
  deterministic = createDeterministicInvestigationPlanner(),
): InvestigationPlanner {
  return Object.freeze({
    async proposeNextOperations(state: Readonly<DeterministicPlannerState>) {
      return deterministic.proposeNextOperations(state);
    },
  });
}

export function createModelAssistedInvestigationPlanner(
  options: ModelAssistedInvestigationPlannerOptions,
): InvestigationPlanner {
  const deterministic = options.deterministic ?? createDeterministicInvestigationPlanner();
  const policy = normalizeModelPlannerPolicy(options.policy ?? DEFAULT_MODEL_PLANNER_POLICY);
  const tracker = options.tracker ?? defaultModelPlannerRequestTracker;
  const clock = options.clock ?? { monotonicMs: () => Math.floor(performance.now()) };
  let attempts = 0;

  return Object.freeze({
    async proposeNextOperations(
      state: Readonly<DeterministicPlannerState>,
      runnerSignal?: AbortSignal,
    ) {
      const deterministicPlan = deterministic.proposeNextOperations(state);
      const signal = runnerSignal ?? options.signal;
      if (signal?.aborted) return deterministicPlan;
      if (
        attempts >= policy.maxModelCallsPerInvestigation ||
        state.budgetState.budget.maxWallTimeMs - state.budgetState.usage.wallTimeMs <= 1
      ) {
        options.observe?.(observation({
          requestId: options.requestId,
          plannerMode: "model_assisted",
          attempt: attempts + 1,
          actionKind: null,
          accepted: false,
          fallbackReason: "budget_rejected",
          inputBytes: 0,
          outputBytes: 0,
          durationMs: 0,
          providerIdentifier: null,
          modelIdentifier: null,
        }));
        return deterministicPlan;
      }
      attempts += 1;
      let context;
      try {
        context = createModelPlannerContext({
          state,
          requestId: `${options.requestId}:${attempts}`,
          policy,
          deterministicPlan,
        });
      } catch (error) {
        options.observe?.(observation({
          requestId: options.requestId,
          plannerMode: "model_assisted",
          attempt: attempts,
          actionKind: null,
          accepted: false,
          fallbackReason:
            error instanceof Error && error.message === "budget_rejected"
              ? "budget_rejected"
              : "privacy_rejected",
          inputBytes: 0,
          outputBytes: 0,
          durationMs: 0,
          providerIdentifier: null,
          modelIdentifier: null,
        }));
        return deterministicPlan;
      }
      const inputBytes = Buffer.byteLength(JSON.stringify(context), "utf8");
      const started = clock.monotonicMs();
      const tracked = await tracker.run({
        timeoutMs: Math.min(
          policy.maxModelPlannerWallTimeMs,
          Math.max(
            1,
            state.budgetState.budget.maxWallTimeMs - state.budgetState.usage.wallTimeMs,
          ),
        ),
        parentSignal: signal,
        execute: (modelSignal) => options.model.propose(context, modelSignal),
      });
      if (tracked.status !== "completed") {
        const reason: ModelPlannerFallbackReason = tracked.status === "cancelled"
          ? "cancellation"
          : tracked.status === "provider_error"
            ? fallbackCode(tracked.error)
            : tracked.status;
        options.observe?.(observation({
          requestId: options.requestId,
          plannerMode: "model_assisted",
          attempt: attempts,
          actionKind: null,
          accepted: false,
          fallbackReason: reason,
          inputBytes,
          outputBytes: 0,
          durationMs: clock.monotonicMs() - started,
          providerIdentifier: null,
          modelIdentifier: null,
        }));
        return deterministicPlan;
      }
      const providerResult = tracked.value;
      let actionKind: ModelPlannerObservation["actionKind"] = null;
      try {
        if (
          !Number.isSafeInteger(providerResult.outputBytes) ||
          providerResult.outputBytes < 0 ||
          providerResult.outputBytes > policy.maxModelOutputBytes
        ) {
          throw new ModelPlannerProposalError("budget_rejected");
        }
        const proposal = validateModelPlannerProposal(providerResult.proposal, policy);
        actionKind = proposal.action.kind;
        const plan = createValidatedModelInvestigationPlan({
          proposal,
          state,
          deterministicPlan,
        });
        options.observe?.(observation({
          requestId: options.requestId,
          plannerMode: "model_assisted",
          attempt: attempts,
          actionKind,
          accepted: true,
          fallbackReason: null,
          inputBytes,
          outputBytes: providerResult.outputBytes,
          durationMs: clock.monotonicMs() - started,
          providerIdentifier: providerResult.providerIdentifier,
          modelIdentifier: providerResult.modelIdentifier,
        }));
        return plan;
      } catch (error) {
        options.observe?.(observation({
          requestId: options.requestId,
          plannerMode: "model_assisted",
          attempt: attempts,
          actionKind,
          accepted: false,
          fallbackReason: fallbackCode(error),
          inputBytes,
          outputBytes:
            Number.isSafeInteger(providerResult.outputBytes) && providerResult.outputBytes >= 0
              ? providerResult.outputBytes
              : 0,
          durationMs: clock.monotonicMs() - started,
          providerIdentifier: providerResult.providerIdentifier,
          modelIdentifier: providerResult.modelIdentifier,
        }));
        return deterministicPlan;
      }
    },
  });
}

export function plannerModeObservation(
  mode: ContextEnginePlannerMode,
  requestId: string,
): ModelPlannerObservation {
  return observation({
    requestId,
    plannerMode: mode,
    attempt: 0,
    actionKind: null,
    accepted: false,
    fallbackReason: mode === "deterministic" ? "disabled" : "unavailable",
    inputBytes: 0,
    outputBytes: 0,
    durationMs: 0,
    providerIdentifier: null,
    modelIdentifier: null,
  });
}
