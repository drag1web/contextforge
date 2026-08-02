import { createHash } from "node:crypto";

import {
  createContextProjectionService,
} from "../application/index.js";
import type {
  InvestigationBudget,
  InvestigationRequest,
  InvestigationRequestId,
} from "../contracts/index.js";
import {
  createLegacyTaskFileSelectionProjection,
  createOfflineCompatibilityComparison,
} from "../adapters/index.js";
import { cloneDomainValue, stableCompare, stableSerialize } from "../domain/investigationDomainSupport.js";
import { compareDeterministicReplays } from "./deterministicReplay.js";
import { isTrustedDeterministicValidationExecutor } from "./deterministicValidationExecutor.js";
import { applyGoldenMode, createGoldenTraceSummary } from "./goldenTraceSummary.js";
import { evaluateValidationExpectations } from "./validationExpectationEvaluator.js";
import { validateContextEngineValidationManifest } from "./validationManifestInvariant.js";
import { calculateValidationMetrics, evaluateValidationGate } from "./validationMetrics.js";
import { validateContextEngineValidationReport } from "./validationReport.js";
import {
  normalizeValidationErrorCode,
  validateOptionalDuration,
  validateStageTimings,
} from "./validationPrivacy.js";
import type {
  ContextEngineValidationCase,
  ContextEngineValidationReport,
  ContextEngineValidationRunner,
  ValidationCaseResult,
  ValidationExecutionArtifacts,
  ValidationProjectLoadResult,
  ValidationRunnerDependencies,
  ValidationRunOptions,
  ValidationVerdict,
} from "./validationTypes.js";

const DEFAULT_BUDGET: InvestigationBudget = {
  maxOperations: 60,
  maxFileReads: 30,
  maxFileBytes: 2_000_000,
  maxParsedFiles: 30,
  maxRelationshipHops: 20,
  maxWallTimeMs: 60_000,
  maxPlannerRounds: 40,
  maxConcurrentOperations: 1,
};
const VERDICTS: ValidationVerdict[] = [
  "PASS", "ACCEPTABLE", "SAFE_FAIL", "CRITICAL_FAIL", "ENGINE_ERROR", "NOT_RUN",
];

export class ValidationRunnerError extends Error {
  readonly code = "invalid_validation_run" as const;
  readonly stage = "CE2-06" as const;

  constructor(message: string) {
    super(message);
    this.name = "ValidationRunnerError";
  }
}

export class ValidationRunGateError extends ValidationRunnerError {
  readonly report: ContextEngineValidationReport;

  constructor(report: ContextEngineValidationReport) {
    super("Offline validation failed an explicitly requested command gate.");
    this.name = "ValidationRunGateError";
    this.report = report;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateRunOptions(raw: ValidationRunOptions): ValidationRunOptions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) ||
    (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) {
    throw new ValidationRunnerError("Validation run options failed safe runtime validation.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const allowed = new Set([
    "mode", "updateReason", "repeatCount", "projectFilter", "caseFilter", "runtimeRoots",
    "failOnCritical", "failOnEngineError", "goldenStore",
  ]);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.has(key)) ||
    Object.values(descriptors).some((descriptor) => !("value" in descriptor) || !descriptor.enumerable)) {
    throw new ValidationRunnerError("Validation run options failed safe runtime validation.");
  }
  const cloneable = Object.fromEntries(Object.entries(descriptors)
    .filter(([key]) => key !== "goldenStore")
    .map(([key, descriptor]) => [key, descriptor.value]));
  const options = cloneDomainValue(cloneable) as ValidationRunOptions;
  const store = descriptors.goldenStore?.value;
  if (store !== undefined) {
    if (typeof store !== "object" || store === null ||
      typeof (store as { read?: unknown }).read !== "function" ||
      typeof (store as { write?: unknown }).write !== "function") {
      throw new ValidationRunnerError("Golden store must implement read and write operations.");
    }
    options.goldenStore = store as ValidationRunOptions["goldenStore"];
  }
  if (options.mode !== undefined && options.mode !== "verify" && options.mode !== "update_golden") {
    throw new ValidationRunnerError("Validation mode is unsupported.");
  }
  if (options.failOnCritical !== undefined && typeof options.failOnCritical !== "boolean" ||
    options.failOnEngineError !== undefined && typeof options.failOnEngineError !== "boolean") {
    throw new ValidationRunnerError("Validation failure options must be boolean.");
  }
  return options;
}

function budgetFor(item: ContextEngineValidationCase): InvestigationBudget {
  return { ...DEFAULT_BUDGET, ...(item.budget ?? {}) };
}

function requestFor(
  item: ContextEngineValidationCase,
  snapshot: ValidationExecutionArtifacts["snapshot"],
  budget: InvestigationBudget,
): InvestigationRequest {
  return {
    requestId: `validation-request-${item.id}` as InvestigationRequestId,
    projectId: snapshot.projectId,
    task: { normalizedTask: item.task.taskText.trim() },
    snapshot,
    explicitTargets: cloneDomainValue(item.explicitTargets ?? []),
    negativeConstraints: cloneDomainValue(item.negativeConstraints ?? []),
    budget,
    purpose: item.purpose,
  };
}

function projectionPurpose(purpose: ContextEngineValidationCase["purpose"]) {
  if (purpose === "implementation_context") return "implementation" as const;
  if (purpose === "review_context") return "review" as const;
  if (purpose === "clarification") return "clarification" as const;
  return "legacy_selection" as const;
}

function verdictRecord(): Record<ValidationVerdict, number> {
  return Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<ValidationVerdict, number>;
}

function notRunResult(
  item: ContextEngineValidationCase,
  errorCode: string,
  executionMarker: ValidationCaseResult["executionMarker"],
): ValidationCaseResult {
  return {
    caseId: item.id,
    projectId: item.projectId,
    title: item.title,
    verdict: "NOT_RUN",
    executionMarker,
    severityIfFailed: item.severityIfFailed,
    failures: [],
    compatibilityNotes: [],
    errorCode,
    redactions: ["local_root", "source_content", "error_detail"],
  };
}

function engineErrorResult(
  item: ContextEngineValidationCase,
  errorCode: string,
  executionMarker: ValidationCaseResult["executionMarker"],
): ValidationCaseResult {
  return {
    caseId: item.id,
    projectId: item.projectId,
    title: item.title,
    verdict: "ENGINE_ERROR",
    executionMarker,
    severityIfFailed: item.severityIfFailed,
    failures: [],
    compatibilityNotes: [],
    errorCode,
    redactions: ["error_detail", "source_content"],
  };
}

async function executeOnce(input: {
  dependencies: ValidationRunnerDependencies;
  item: ContextEngineValidationCase;
  project: Parameters<ValidationRunnerDependencies["executor"]["execute"]>[0]["project"];
  loaded: Extract<ValidationProjectLoadResult, { status: "available" }>;
}): Promise<ValidationExecutionArtifacts> {
  const budget = budgetFor(input.item);
  const execution = await input.dependencies.executor.execute({
    project: input.project,
    validationCase: input.item,
    snapshot: input.loaded.snapshot,
    request: requestFor(input.item, input.loaded.snapshot, budget),
    budget,
  });
  const durationMs = validateOptionalDuration(execution.durationMs);
  const stageTimingsMs = validateStageTimings(execution.stageTimingsMs);
  const projectionService = createContextProjectionService();
  const projection = projectionService.project({
    result: execution.result,
    snapshot: input.loaded.snapshot,
    purpose: projectionPurpose(input.item.purpose),
    explicitTargets: input.item.explicitTargets ?? [],
    negativeConstraints: input.item.negativeConstraints ?? [],
  });
  const legacyCompatibleProjection = projectionService.project({
    result: execution.result,
    snapshot: input.loaded.snapshot,
    purpose: "legacy_selection",
    explicitTargets: input.item.explicitTargets ?? [],
    negativeConstraints: input.item.negativeConstraints ?? [],
  });
  const legacyProjection = createLegacyTaskFileSelectionProjection().project(
    legacyCompatibleProjection,
    input.loaded.snapshot,
    {
      effectiveTaskArea: "general",
      requestedTaskType: "implementation",
      durationMs,
      negativeConstraints: input.item.negativeConstraints ?? [],
    },
  );
  const compatibility = execution.legacySelection
    ? createOfflineCompatibilityComparison().compare({
        legacySelection: execution.legacySelection,
        v2Projection: legacyCompatibleProjection,
        snapshot: input.loaded.snapshot,
        negativeConstraints: input.item.negativeConstraints ?? [],
        explicitTargets: input.item.explicitTargets ?? [],
        ...(input.item.expectations.legacyComparison?.basis === undefined
          ? {}
          : { evaluationBasis: input.item.expectations.legacyComparison.basis }),
      })
    : undefined;
  return {
    snapshot: input.loaded.snapshot,
    investigation: execution.result,
    projection,
    legacyProjection,
    ...(compatibility === undefined ? {} : { compatibility }),
    durationMs,
    stageTimingsMs: Object.fromEntries(Object.entries(stageTimingsMs)
      .sort(([left], [right]) => stableCompare(left, right))),
  };
}

export function createContextEngineValidationRunner(
  dependencies: ValidationRunnerDependencies,
): ContextEngineValidationRunner {
  const executionMarker: ValidationCaseResult["executionMarker"] =
    isTrustedDeterministicValidationExecutor(dependencies.executor)
      ? "real_engine"
      : "fixture_result";
  return {
    async run(rawManifest, rawOptions = {}) {
      const manifest = validateContextEngineValidationManifest(rawManifest);
      const options = validateRunOptions(rawOptions as ValidationRunOptions);
      const mode = options.mode ?? "verify";
      if (mode === "update_golden" && (!options.updateReason || options.updateReason.trim().length === 0)) {
        throw new ValidationRunnerError("Golden update requires --reason metadata.");
      }
      const repeatCount = options.repeatCount ?? 1;
      if (!Number.isSafeInteger(repeatCount) || repeatCount < 1 || repeatCount > 20) {
        throw new ValidationRunnerError("Repeat count must be a safe integer within 1..20.");
      }
      const projectFilter = [...(options.projectFilter ?? [])].sort(stableCompare);
      const caseFilter = [...(options.caseFilter ?? [])].sort(stableCompare);
      const selectedCases = manifest.cases
        .filter((item) => projectFilter.length === 0 || projectFilter.includes(item.projectId))
        .filter((item) => caseFilter.length === 0 || caseFilter.includes(item.id))
        .sort((left, right) => stableCompare(left.id, right.id));
      const projectsById = new Map(manifest.projects.map((project) => [project.id, project]));
      const loads = new Map<string, ValidationProjectLoadResult>();
      const caseResults: ValidationCaseResult[] = [];
      let deterministicCases = 0;
      let deterministicEquivalent = 0;

      for (const item of selectedCases) {
        const project = projectsById.get(item.projectId)!;
        let loaded = loads.get(project.id);
        if (!loaded) {
          try {
            loaded = await dependencies.projectLoader.load({
              project,
              runtimeRoots: options.runtimeRoots ?? {},
            });
          } catch {
            loaded = { status: "unavailable", reasonCode: "project_unavailable", message: "Project source is unavailable." };
          }
          loads.set(project.id, loaded);
        }
        if (loaded.status === "unavailable") {
          caseResults.push(notRunResult(item, loaded.reasonCode, executionMarker));
          continue;
        }
        try {
          const artifacts: ValidationExecutionArtifacts[] = [];
          const summaries = [];
          for (let repeat = 0; repeat < repeatCount; repeat += 1) {
            const artifact = await executeOnce({ dependencies, item, project, loaded });
            artifacts.push(artifact);
            summaries.push(createGoldenTraceSummary({ caseId: item.id, artifacts: artifact }));
          }
          const replay = compareDeterministicReplays(summaries);
          if (executionMarker === "real_engine") {
            deterministicCases += 1;
            if (replay.equivalent) deterministicEquivalent += 1;
          }
          const evaluated = evaluateValidationExpectations({ validationCase: item, artifacts: artifacts[0]! });
          const failures = [...evaluated.failures];
          let verdict = evaluated.verdict;
          if (!replay.equivalent) {
            failures.push({
              code: "nondeterministic_replay", category: "safety", severity: "critical",
              message: "Repeated normalized validation traces are not equivalent.",
            });
            verdict = "CRITICAL_FAIL";
          }
          if (options.goldenStore) {
            const comparison = await applyGoldenMode({
              store: options.goldenStore,
              caseId: item.id,
              summary: summaries[0]!,
              mode,
              ...(options.updateReason === undefined ? {} : { reason: options.updateReason }),
            });
            if (comparison && !comparison.equivalent) {
              failures.push({
                code: "golden_semantic_drift", category: "knowledge",
                severity: item.severityIfFailed,
                message: "Normalized trace differs from the reviewed golden trace.",
              });
              verdict = item.severityIfFailed === "critical" ? "CRITICAL_FAIL" : "SAFE_FAIL";
            }
          }
          if (loaded.verifyUnchanged && !(await loaded.verifyUnchanged())) {
            failures.push({
              code: "source_modified", category: "safety", severity: "critical",
              message: "Offline validation detected a source-integrity change.",
            });
            verdict = "CRITICAL_FAIL";
          }
          caseResults.push({
            caseId: item.id,
            projectId: item.projectId,
            title: item.title,
            verdict,
            executionMarker,
            severityIfFailed: item.severityIfFailed,
            failures: failures.sort((left, right) => stableCompare(left.code, right.code)),
            compatibilityNotes: [],
            trace: summaries[0],
            metrics: evaluated.metrics,
            ...(artifacts[0]!.compatibility === undefined ? {} : { compatibility: artifacts[0]!.compatibility }),
            redactions: ["absolute_root", "source_content", "runtime_timestamp", "duration_from_golden"],
          });
        } catch (error) {
          const errorCode = typeof error === "object" && error !== null && "code" in error
            ? normalizeValidationErrorCode(error.code)
            : "unexpected_execution_failure";
          caseResults.push(engineErrorResult(
            item,
            errorCode,
            executionMarker,
          ));
        }
      }

      const replayEquivalence = deterministicCases === 0 ? 1 : deterministicEquivalent / deterministicCases;
      const metrics = calculateValidationMetrics(caseResults, replayEquivalence);
      const projectSummaries = manifest.projects
        .filter((project) => projectFilter.length === 0 || projectFilter.includes(project.id))
        .sort((left, right) => stableCompare(left.id, right.id))
        .map((project) => {
          const rows = caseResults.filter((row) => row.projectId === project.id);
          const verdicts = verdictRecord();
          rows.forEach((row) => { verdicts[row.verdict] += 1; });
          return {
            projectId: project.id,
            available: loads.get(project.id)?.status === "available",
            cases: rows.length,
            verdicts,
          };
        });
      const runId = `validation-${hash(stableSerialize({
        manifestId: manifest.manifestId, projectFilter, caseFilter, repeatCount, mode,
      })).slice(0, 20)}`;
      const report: ContextEngineValidationReport = {
        schemaVersion: 1,
        manifest: { schemaVersion: 1, manifestId: manifest.manifestId, title: manifest.title },
        run: { runId, mode, repeatCount, projectFilter, caseFilter },
        projects: projectSummaries,
        cases: caseResults.sort((left, right) => stableCompare(left.caseId, right.caseId)),
        metrics,
        gate: evaluateValidationGate(metrics),
        unavailableProjects: projectSummaries.filter((project) => !project.available).map((project) => project.projectId),
        redaction: {
          absoluteRootsExcluded: true,
          sourceContentExcluded: true,
          secretsExcluded: true,
          redactedFields: ["project.source.root", "source.content", "error.stack", "operation.timestamps"],
        },
        knownLimitations: [
          "Local projects require an explicitly supplied offline project loader and CE2 repository operation adapter.",
          "The proposed 85% acceptable-or-better threshold is reported but not evaluated without a measured cross-project suite.",
          "Selector benchmark baseline fails at benchmarkSmoke.ts:154 (missingRouteGroup.manualReview); server/src/selection is unchanged from CE2-05.",
        ],
      };
      const validated = validateContextEngineValidationReport(report);
      const frozen = deepFreeze(validated);
      if (
        (options.failOnCritical === true && frozen.cases.some((item) =>
          item.executionMarker === "real_engine" && item.verdict === "CRITICAL_FAIL")) ||
        (options.failOnEngineError === true && frozen.cases.some((item) =>
          item.executionMarker === "real_engine" && item.verdict === "ENGINE_ERROR"))
      ) {
        throw new ValidationRunGateError(frozen);
      }
      return frozen;
    },
  };
}
