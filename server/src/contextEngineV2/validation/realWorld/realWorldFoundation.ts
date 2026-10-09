import {
  REAL_WORLD_EFFECTS, REAL_WORLD_FOUNDATION_PROFILE, REAL_WORLD_STAGES,
  REAL_WORLD_TECHNICAL_STATUSES,
} from "./realWorldTypes.js";
import type {
  RealWorldDependencyAssessment, RealWorldDiagnosticRecord, RealWorldEffect,
  RealWorldFoundation, RealWorldFoundationCaseResult, RealWorldFoundationPlan,
  RealWorldFoundationReport, RealWorldReason, RealWorldRunnerTask,
  RealWorldTechnicalStatus,
} from "./realWorldTypes.js";

// Mechanical safety bounds, not CE2 budgets or a future human-task wire schema.
export const MAX_FOUNDATION_CASES = 256;
export const MAX_FOUNDATION_DIAGNOSTICS = 256;
export const MAX_MECHANICAL_TASK_CHARS = 1_000_000;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const CASE_ID = /^mechanical-[0-9]{3,6}$/u;
const RUN_ID = /^mechanical-run-[0-9]{3,6}$/u;
const PROJECT_ALIAS = /^fixture-[0-9]{3,6}$/u;

export class RealWorldFoundationError extends Error {
  constructor(readonly code: "invalid_plan" | "unknown_case" | "already_accounted" | "session_sealed") {
    super(code); // Never include raw input, exception messages, stacks or causes in reports.
    this.name = "RealWorldFoundationError";
  }
}

/** Reject getters/functions, extra (including oracle) fields and non-data objects. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new RealWorldFoundationError("invalid_plan");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new RealWorldFoundationError("invalid_plan");
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new RealWorldFoundationError("invalid_plan");
    }
    output[key] = descriptor.value;
  }
  return output;
}

function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new RealWorldFoundationError("invalid_plan");
  return value;
}

function literal<T extends string>(value: unknown, expected: T): T {
  if (value !== expected) throw new RealWorldFoundationError("invalid_plan");
  return expected;
}

/** Dense data arrays only; never iterate caller-provided iterators or accessors. */
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new RealWorldFoundationError("invalid_plan");
  }
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value as number;
  if (!Number.isSafeInteger(length) || length < 1 || length > maximum) {
    throw new RealWorldFoundationError("invalid_plan");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length + 1) throw new RealWorldFoundationError("invalid_plan");
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new RealWorldFoundationError("invalid_plan");
    }
    output.push(descriptor.value);
  }
  return output;
}

function parsePlan(value: unknown): RealWorldFoundationPlan {
  const plan = record(value, ["profileId", "runId", "protocolDigest", "sourceBasis", "runtimeIdentity", "plannedCaseIds", "dependencies"]);
  const source = record(plan.sourceBasis, ["kind", "projectAlias", "manifestDigest", "authorization", "authorizationEvidenceDigest"]);
  const runtime = record(plan.runtimeIdentity, [
    "contextforgeCommit", "toolingDigest", "settingsBasis", "safeSettingsDigest", "productionPolicyDigest",
    "intendedEngineMode", "intendedPlannerMode", "understandingAvailability",
  ]);
  const plannedCaseIds = list(plan.plannedCaseIds, MAX_FOUNDATION_CASES).map((id) => text(id, CASE_ID));
  if (new Set(plannedCaseIds).size !== plannedCaseIds.length) throw new RealWorldFoundationError("invalid_plan");
  const dependencies = list(plan.dependencies, REAL_WORLD_EFFECTS.length).map((raw): RealWorldDependencyAssessment => {
    const item = record(raw, ["effect", "disposition", "evidenceDigest"]);
    if (!REAL_WORLD_EFFECTS.includes(item.effect as RealWorldEffect) ||
        !["unresolved", "excluded", "isolated", "write_capable"].includes(item.disposition as string)) {
      throw new RealWorldFoundationError("invalid_plan");
    }
    const disposition = item.disposition as RealWorldDependencyAssessment["disposition"];
    const evidenceDigest = item.evidenceDigest === null ? null : text(item.evidenceDigest, SHA256);
    if ((disposition === "isolated" || disposition === "excluded") && evidenceDigest === null) {
      throw new RealWorldFoundationError("invalid_plan");
    }
    return { effect: item.effect as RealWorldEffect, disposition, evidenceDigest };
  });
  if (dependencies.length !== REAL_WORLD_EFFECTS.length || new Set(dependencies.map((item) => item.effect)).size !== dependencies.length) {
    throw new RealWorldFoundationError("invalid_plan");
  }
  // Canonical fixed ordering, without trusting caller order as policy.
  dependencies.sort((left, right) => REAL_WORLD_EFFECTS.indexOf(left.effect) - REAL_WORLD_EFFECTS.indexOf(right.effect));
  return {
    profileId: literal(plan.profileId, REAL_WORLD_FOUNDATION_PROFILE),
    runId: text(plan.runId, RUN_ID),
    protocolDigest: text(plan.protocolDigest, SHA256),
    sourceBasis: {
      kind: literal(source.kind, "synthetic_inert"), projectAlias: text(source.projectAlias, PROJECT_ALIAS),
      manifestDigest: text(source.manifestDigest, SHA256), authorization: literal(source.authorization, "mechanical_only"),
      authorizationEvidenceDigest: text(source.authorizationEvidenceDigest, SHA256),
    },
    runtimeIdentity: {
      contextforgeCommit: text(runtime.contextforgeCommit, COMMIT), toolingDigest: text(runtime.toolingDigest, SHA256),
      settingsBasis: literal(runtime.settingsBasis, "synthetic_inert"), safeSettingsDigest: text(runtime.safeSettingsDigest, SHA256),
      productionPolicyDigest: text(runtime.productionPolicyDigest, SHA256), intendedEngineMode: literal(runtime.intendedEngineMode, "primary"),
      intendedPlannerMode: literal(runtime.intendedPlannerMode, "deterministic"), understandingAvailability: literal(runtime.understandingAvailability, "unresolved"),
    },
    plannedCaseIds, dependencies,
  };
}

function parseTask(value: unknown): RealWorldRunnerTask {
  const task = record(value, ["rawTask", "taskType", "targetTool"]);
  if (typeof task.rawTask !== "string" || task.rawTask.length === 0 || task.rawTask.length > MAX_MECHANICAL_TASK_CHARS ||
      typeof task.taskType !== "string" || task.taskType.length === 0 || task.taskType.length > 80 ||
      typeof task.targetTool !== "string" || task.targetTool.length === 0 || task.targetTool.length > 80) {
    throw new RealWorldFoundationError("invalid_plan");
  }
  return { rawTask: task.rawTask, taskType: task.taskType, targetTool: task.targetTool };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Non-executing admission/accounting foundation. All stages stay BLOCKED in RW-02A.
 * There is deliberately no executor, storage, provider, filesystem, clock, sink or
 * arbitrary callback injection. Documentary 'isolated' claims cannot enable a run.
 * This is not a JS sandbox: do not pass hostile Proxies or execute untrusted code.
 */
export function createRealWorldFoundation(rawPlan: unknown): RealWorldFoundation {
  let plan: RealWorldFoundationPlan;
  try { plan = freeze(parsePlan(rawPlan)); }
  catch { throw new RealWorldFoundationError("invalid_plan"); }
  const results = new Map<string, RealWorldFoundationCaseResult>();
  const diagnostics: RealWorldDiagnosticRecord[] = [];
  let droppedRecords = 0;
  let sealedReport: RealWorldFoundationReport | null = null;
  const unresolved = plan.dependencies.filter((item) => item.disposition === "unresolved").map((item) => item.effect);
  const writes = plan.dependencies.filter((item) => item.disposition === "write_capable").map((item) => item.effect);

  function assertSlot(caseId: string): void {
    if (sealedReport) throw new RealWorldFoundationError("session_sealed");
    if (!plan.plannedCaseIds.includes(caseId)) throw new RealWorldFoundationError("unknown_case");
    if (results.has(caseId)) throw new RealWorldFoundationError("already_accounted");
  }

  function account(caseId: string, status: RealWorldFoundationCaseResult["technicalStatus"], reasons: RealWorldReason[]): RealWorldFoundationCaseResult {
    const result = freeze({
      caseId, technicalStatus: status, reasonCodes: reasons,
      unresolvedEffects: [...unresolved], writeCapableEffects: [...writes],
      engineInvoked: false as const, semanticVerdict: null, engineOutcome: null, durationMs: null,
    });
    results.set(caseId, result);
    for (const code of reasons) {
      if (diagnostics.length < MAX_FOUNDATION_DIAGNOSTICS) {
        diagnostics.push(freeze({ sequence: diagnostics.length + 1, caseId, technicalStatus: status, code }));
      } else droppedRecords += 1;
    }
    return result;
  }

  return Object.freeze({
    assessCase(caseId: string, task: unknown) {
      assertSlot(caseId);
      // Validate then discard private data: it never enters diagnostic/report state.
      try { parseTask(task); }
      catch { return account(caseId, "invalid_input", ["invalid_task_input"]); }
      const reasons: RealWorldReason[] = ["adapters_not_wired"];
      if (unresolved.length > 0) reasons.push("dependency_unresolved");
      if (writes.length > 0) reasons.push("write_capability_rejected");
      return account(caseId, "not_run", reasons);
    },
    skipCase(caseId: string) {
      assertSlot(caseId);
      return account(caseId, "skipped", ["explicit_skip"]);
    },
    finalize() {
      if (sealedReport) return sealedReport;
      for (const caseId of plan.plannedCaseIds) {
        if (!results.has(caseId)) account(caseId, "not_run", ["not_requested", "adapters_not_wired"]);
      }
      const cases = plan.plannedCaseIds.map((id) => results.get(id)!);
      const statusCounts = Object.fromEntries(REAL_WORLD_TECHNICAL_STATUSES.map((status) => [status, 0])) as Record<RealWorldTechnicalStatus, number>;
      for (const result of cases) statusCounts[result.technicalStatus] += 1;
      sealedReport = freeze({
        profileId: REAL_WORLD_FOUNDATION_PROFILE, identity: plan,
        parity: REAL_WORLD_STAGES.map((stage) => ({ stage, status: "blocked" as const, reason: "adapters_not_wired" as const })),
        cases,
        accounting: { planned: cases.length, accounted: cases.length, statusCounts, engineInvocations: 0 as const, semanticEvaluations: 0 as const, qualityMeasurement: null },
        diagnostics: { records: [...diagnostics], droppedRecords, persistence: "memory_only" as const },
        executionEnabled: false as const, fullProductionParity: false as const,
      });
      return sealedReport;
    },
  });
}
