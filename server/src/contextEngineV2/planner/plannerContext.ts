import { createHash } from "node:crypto";

import type {
  ModelPlannerContext,
  ModelPlannerPriorActionSummary,
} from "../contracts/index.js";
import type { DeterministicPlannerState } from "../application/index.js";
import type { DeterministicInvestigationPlan } from "../application/index.js";
import { isSecretLikeSemanticLiteral } from "../domain/semanticLiteralSafety.js";
import type { ModelPlannerPolicy } from "./plannerPolicy.js";
import { normalizeModelPlannerPolicy } from "./plannerPolicy.js";
import { deriveGroundedModelCandidatePaths } from "./plannerCandidatePaths.js";

function fail(code: "privacy_rejected" | "budget_rejected" = "privacy_rejected"): never {
  throw new Error(code);
}

function assertPlainRecord(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some(
      (entry) => entry.get || entry.set || !("value" in entry) || !entry.enumerable,
    )
  ) fail();
}

function dense<T>(value: readonly T[], maximum: number): T[] {
  if (!Array.isArray(value) || value.length > maximum) fail("budget_rejected");
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) fail();
  }
  return [...value];
}

function safeText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    isSecretLikeSemanticLiteral(value)
  ) fail();
  return value.trim();
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function operationTarget(record: DeterministicPlannerState["operationRecords"][number]): string {
  const operation = record.operation;
  switch (operation.type) {
    case "search_paths":
    case "search_symbols":
    case "search_text":
      return operation.query;
    case "read_file":
    case "parse_file":
    case "inspect_manifest":
      return operation.path;
    case "read_range":
      return `${operation.path}:${operation.startLine}-${operation.endLine}`;
    case "follow_relationship":
      return `${operation.fromEntityId}:${operation.predicates.join(",")}`;
    case "inspect_git_context":
      return operation.paths.join(",");
    case "evaluate_absence":
      return `${operation.query}:${operation.scopes.join(",")}`;
  }
}

function priorActionSummary(
  record: DeterministicPlannerState["operationRecords"][number],
): ModelPlannerPriorActionSummary {
  return {
    actionKind: record.operation.type,
    status: record.status,
    targetHash: hash(operationTarget(record)),
  };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createModelPlannerContext(input: {
  state: Readonly<DeterministicPlannerState>;
  requestId: string;
  policy?: ModelPlannerPolicy;
  deterministicPlan?: DeterministicInvestigationPlan;
}): ModelPlannerContext {
  assertPlainRecord(input);
  assertPlainRecord(input.state);
  const policy = normalizeModelPlannerPolicy(input.policy);
  const state = input.state;
  const normalizedTask = safeText(
    state.taskUnderstanding?.normalizedTask,
    policy.maxTaskChars,
  );
  const explicitTargets = dense(state.explicitTargets, policy.maxReasonCodeEntries)
    .map((target) =>
      target.kind === "path"
        ? `path:${safeText(target.path, 500)}`
        : `symbol:${safeText(target.symbol, policy.maxQueryChars)}`,
    )
    .sort();
  const negativeConstraints = dense(
    state.negativeConstraints,
    policy.maxReasonCodeEntries,
  )
    .map((constraint) =>
      constraint.kind === "path"
        ? `path:${safeText(constraint.pattern, 500)}`
        : `semantic:${safeText(constraint.description, 500)}`,
    )
    .sort();
  const hypotheses = dense(state.hypotheses, policy.maxHypotheses)
    .map((hypothesis) => ({ id: hypothesis.id, status: hypothesis.status }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const gaps = dense(state.knowledgeGaps, policy.maxGaps)
    .map((gap) => ({
      id: gap.id,
      category: safeText(gap.category, 120),
      blocking: gap.status === "open" && gap.blocks.length > 0,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const entities = dense(state.entities, policy.maxKnownEntities)
    .map((entity) => ({
      id: entity.id,
      kind: safeText(entity.kind, 120),
      ...(entity.fileId
        ? {
            path: state.snapshot.files.find((file) => file.id === entity.fileId)
              ?.normalizedPath,
          }
        : {}),
    }))
    .filter((entity) => entity.path === undefined || !isSecretLikeSemanticLiteral(entity.path))
    .sort((left, right) => left.id.localeCompare(right.id));
  const candidatePaths = deriveGroundedModelCandidatePaths({
    state,
    deterministicPlan: input.deterministicPlan,
    maximum: policy.maxCandidatePaths,
  }).filter((path) => !isSecretLikeSemanticLiteral(path));
  const priorActions = dense(state.operationRecords, policy.maxPriorActions)
    .map(priorActionSummary)
    .sort((left, right) =>
      `${left.actionKind}\0${left.targetHash}\0${left.status}`.localeCompare(
        `${right.actionKind}\0${right.targetHash}\0${right.status}`,
      ),
    );
  const { budget, usage } = state.budgetState;
  const context: ModelPlannerContext = {
    schemaVersion: 1,
    requestId: hash(safeText(input.requestId, 200)),
    snapshotId: state.snapshotId,
    normalizedTask,
    explicitTargets,
    negativeConstraints,
    hypotheses,
    gaps,
    entities,
    candidatePaths,
    priorActions,
    budget: {
      remainingOperations: Math.max(0, budget.maxOperations - usage.operations),
      remainingFileReads: Math.max(0, budget.maxFileReads - usage.fileReads),
      remainingFileBytes: Math.max(0, budget.maxFileBytes - usage.fileBytes),
      remainingRelationshipHops: Math.max(
        0,
        budget.maxRelationshipHops - usage.relationshipHops,
      ),
      remainingPlannerRounds: Math.max(
        0,
        budget.maxPlannerRounds - usage.plannerRounds,
      ),
    },
    allowedActionKinds: [
      "inspect_relationship",
      "read_file",
      "read_range",
      "parse_file",
      "search_symbol",
      "search_text",
      "stop",
    ],
  };
  const bytes = Buffer.byteLength(JSON.stringify(context), "utf8");
  if (bytes > policy.maxSerializedInputBytes) fail("budget_rejected");
  return freeze(context);
}
