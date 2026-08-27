import type {
  EntityId,
  InvestigationOperation,
  ModelPlannerActionKind,
  ModelPlannerProposal,
  ModelPlannerReasonCode,
} from "../contracts/index.js";
import type {
  DeterministicInvestigationPlan,
  DeterministicPlannerState,
} from "../application/index.js";
import { createDeterministicOperation } from "../application/operationIdentity.js";
import { withCanonicalOperationCost } from "../application/operationCost.js";
import { pathMatchesNegativeConstraints } from "../application/negativeConstraintMatcher.js";
import { isOperationRetryEligible } from "../application/operationRetryPolicy.js";
import { canFitOperationCost } from "../domain/index.js";
import { isRepositoryRelativePath } from "../domain/invariant.js";
import { isSecretLikeSemanticLiteral } from "../domain/semanticLiteralSafety.js";
import type { ModelPlannerPolicy } from "./plannerPolicy.js";
import { normalizeModelPlannerPolicy } from "./plannerPolicy.js";

export class ModelPlannerProposalError extends Error {
  constructor(
    readonly code:
      | "malformed_output"
      | "schema_rejected"
      | "semantic_rejected"
      | "budget_rejected"
      | "duplicate_rejected"
      | "privacy_rejected"
      | "unsupported_action",
  ) {
    super(code);
    this.name = "ModelPlannerProposalError";
  }
}

const ACTION_KINDS = new Set<ModelPlannerActionKind>([
  "search_symbol",
  "search_text",
  "read_file",
  "read_range",
  "parse_file",
  "inspect_relationship",
  "stop",
]);
const REASON_CODES = new Set<ModelPlannerReasonCode>([
  "inspect_explicit_target",
  "follow_import_edge",
  "resolve_blocking_gap",
  "search_task_symbol",
  "search_task_text",
  "inspect_candidate_file",
  "no_useful_action",
]);
const RELATIONS = new Set([
  "calls",
  "contains",
  "defines_endpoint",
  "defines_route",
  "exports",
  "imports",
  "re_exports",
  "renders",
  "tests",
]);

function record(
  value: unknown,
  fields: readonly string[],
  label: "schema" | "action" = "schema",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelPlannerProposalError("malformed_output");
  }
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some(
      (entry) => entry.get || entry.set || !("value" in entry) || !entry.enumerable,
    )
  ) {
    throw new ModelPlannerProposalError("schema_rejected");
  }
  const actual = Object.keys(descriptors).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new ModelPlannerProposalError(
      label === "action" ? "unsupported_action" : "schema_rejected",
    );
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
  );
}

function openRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelPlannerProposalError("malformed_output");
  }
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some(
      (entry) => entry.get || entry.set || !("value" in entry) || !entry.enumerable,
    )
  ) {
    throw new ModelPlannerProposalError("schema_rejected");
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
  );
}

function safeString(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new ModelPlannerProposalError("schema_rejected");
  }
  if (isSecretLikeSemanticLiteral(value)) {
    throw new ModelPlannerProposalError("privacy_rejected");
  }
  return value.trim();
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ModelPlannerProposalError("schema_rejected");
  }
  return value as number;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function validateModelPlannerProposal(
  raw: unknown,
  policyInput?: ModelPlannerPolicy,
): ModelPlannerProposal {
  const policy = normalizeModelPlannerPolicy(policyInput);
  const proposal = record(raw, ["schemaVersion", "action", "reasonCode"]);
  if (proposal.schemaVersion !== 1 || !REASON_CODES.has(proposal.reasonCode as ModelPlannerReasonCode)) {
    throw new ModelPlannerProposalError("schema_rejected");
  }
  const baseAction = openRecord(proposal.action);
  if (!ACTION_KINDS.has(baseAction.kind as ModelPlannerActionKind)) {
    throw new ModelPlannerProposalError("unsupported_action");
  }
  let action: ModelPlannerProposal["action"];
  switch (baseAction.kind) {
    case "search_symbol": {
      const item = record(proposal.action, ["kind", "symbol"], "action");
      action = { kind: "search_symbol", symbol: safeString(item.symbol, policy.maxQueryChars) };
      break;
    }
    case "search_text": {
      const item = record(proposal.action, ["kind", "query"], "action");
      action = { kind: "search_text", query: safeString(item.query, policy.maxQueryChars) };
      break;
    }
    case "read_file": {
      const item = record(proposal.action, ["kind", "path"], "action");
      action = { kind: "read_file", path: safeString(item.path, 500) };
      break;
    }
    case "read_range": {
      const item = record(
        proposal.action,
        ["kind", "path", "startLine", "endLine"],
        "action",
      );
      const startLine = positiveInteger(item.startLine);
      const endLine = positiveInteger(item.endLine);
      if (endLine < startLine || endLine - startLine + 1 > policy.maxReadRangeLines) {
        throw new ModelPlannerProposalError("semantic_rejected");
      }
      action = {
        kind: "read_range",
        path: safeString(item.path, 500),
        startLine,
        endLine,
      };
      break;
    }
    case "parse_file": {
      const item = record(proposal.action, ["kind", "path"], "action");
      action = { kind: "parse_file", path: safeString(item.path, 500) };
      break;
    }
    case "inspect_relationship": {
      const item = record(
        proposal.action,
        ["kind", "sourceEntityId", "relation"],
        "action",
      );
      action = {
        kind: "inspect_relationship",
        sourceEntityId: safeString(item.sourceEntityId, 200) as EntityId,
        relation: safeString(item.relation, 120),
      };
      break;
    }
    case "stop": {
      const item = record(proposal.action, ["kind", "reason"], "action");
      if (item.reason !== "sufficient_information" && item.reason !== "no_useful_action") {
        throw new ModelPlannerProposalError("schema_rejected");
      }
      action = { kind: "stop", reason: item.reason };
      break;
    }
    default:
      throw new ModelPlannerProposalError("unsupported_action");
  }
  return freeze({
    schemaVersion: 1,
    action,
    reasonCode: proposal.reasonCode as ModelPlannerReasonCode,
  });
}

function groundedSearchQuery(
  query: string,
  state: Readonly<DeterministicPlannerState>,
): boolean {
  const normalized = query.toLocaleLowerCase("en-US");
  const task = state.taskUnderstanding?.normalizedTask.toLocaleLowerCase("en-US") ?? "";
  if (task.includes(normalized)) return true;
  if (
    state.explicitTargets.some(
      (target) => target.kind === "symbol" && target.symbol.toLocaleLowerCase("en-US") === normalized,
    )
  ) return true;
  return state.entities.some(
    (entity) =>
      entity.displayName.toLocaleLowerCase("en-US") === normalized ||
      entity.canonicalName?.toLocaleLowerCase("en-US") === normalized,
  );
}

function operationForProposal(input: {
  proposal: ModelPlannerProposal;
  state: Readonly<DeterministicPlannerState>;
  deterministicPlan: DeterministicInvestigationPlan;
}): InvestigationOperation | null {
  const { action } = input.proposal;
  if (action.kind === "stop") {
    const hasBlockingGap = input.state.knowledgeGaps.some(
      (gap) => gap.status === "open" && gap.blocks.length > 0,
    );
    if (input.deterministicPlan.productive || hasBlockingGap) {
      throw new ModelPlannerProposalError("semantic_rejected");
    }
    return null;
  }
  if (input.state.repositoryChanged || input.state.budgetState.exhausted.length > 0) {
    throw new ModelPlannerProposalError("budget_rejected");
  }
  const questionIds = [...input.deterministicPlan.consideredQuestionIds].sort();
  const hypothesisIds = [...input.deterministicPlan.consideredHypothesisIds].sort();
  const common = {
    reason: `Validated model planner action: ${input.proposal.reasonCode}.`,
    questionIds,
    hypothesisIds,
    priority: 95,
    estimatedCost: {
      operations: 0,
      fileReads: 0,
      fileBytes: 0,
      parsedFiles: 0,
      relationshipHops: 0,
      plannerRounds: 0,
      wallTimeMs: 0,
    },
    safetyClassification: "safe" as const,
  };
  let operation: InvestigationOperation;
  if (action.kind === "search_symbol" || action.kind === "search_text") {
    const query = action.kind === "search_symbol" ? action.symbol : action.query;
    if (!groundedSearchQuery(query, input.state)) {
      throw new ModelPlannerProposalError("semantic_rejected");
    }
    operation = createDeterministicOperation(input.state.snapshotId, {
      ...common,
      type: action.kind === "search_symbol" ? "search_symbols" : "search_text",
      query,
    });
  } else if (
    action.kind === "read_file" ||
    action.kind === "read_range" ||
    action.kind === "parse_file"
  ) {
    if (!isRepositoryRelativePath(action.path)) {
      throw new ModelPlannerProposalError("privacy_rejected");
    }
    const file = input.state.snapshot.files.find(
      (candidate) => candidate.normalizedPath === action.path,
    );
    if (!file) throw new ModelPlannerProposalError("semantic_rejected");
    if (!file.readable || file.generated || file.secretRisk !== "none") {
      throw new ModelPlannerProposalError("privacy_rejected");
    }
    if (pathMatchesNegativeConstraints(action.path, input.state.negativeConstraints)) {
      throw new ModelPlannerProposalError("privacy_rejected");
    }
    if (
      action.kind === "parse_file" &&
      !input.state.operationRecords.some(
        (record) =>
          record.status === "completed" &&
          (record.operation.type === "read_file" || record.operation.type === "read_range") &&
          record.operation.path === action.path,
      )
    ) {
      throw new ModelPlannerProposalError("semantic_rejected");
    }
    operation = action.kind === "read_file"
      ? createDeterministicOperation(input.state.snapshotId, {
          ...common,
          type: "read_file",
          path: action.path,
        })
      : action.kind === "read_range"
        ? createDeterministicOperation(input.state.snapshotId, {
          ...common,
          type: "read_range",
          path: action.path,
          startLine: action.startLine,
          endLine: action.endLine,
        })
        : createDeterministicOperation(input.state.snapshotId, {
          ...common,
          type: "parse_file",
          path: action.path,
        });
  } else {
    if (
      !RELATIONS.has(action.relation) ||
      !input.state.entities.some((entity) => entity.id === action.sourceEntityId)
    ) {
      throw new ModelPlannerProposalError("semantic_rejected");
    }
    operation = createDeterministicOperation(input.state.snapshotId, {
      ...common,
      type: "follow_relationship",
      fromEntityId: action.sourceEntityId,
      predicates: [action.relation],
      maxHops: 1,
    });
  }
  operation = withCanonicalOperationCost({
    operation,
    snapshot: input.state.snapshot,
  });
  if (
    input.state.operationRecords.some(
      (record) => record.operation.deduplicationKey === operation.deduplicationKey,
    )
  ) {
    throw new ModelPlannerProposalError("duplicate_rejected");
  }
  if (
    !isOperationRetryEligible({
      operation,
      operationRecords: input.state.operationRecords,
      maxFailedOperationRetries: 0,
      budgetState: input.state.budgetState,
      grounded: true,
      repositoryChanged: input.state.repositoryChanged,
    }) ||
    !canFitOperationCost(input.state.budgetState, operation.estimatedCost)
  ) {
    throw new ModelPlannerProposalError("budget_rejected");
  }
  return operation;
}

export function createValidatedModelInvestigationPlan(input: {
  proposal: ModelPlannerProposal;
  state: Readonly<DeterministicPlannerState>;
  deterministicPlan: DeterministicInvestigationPlan;
}): DeterministicInvestigationPlan {
  const operation = operationForProposal(input);
  return {
    rationale: operation ? "model_proposal_accepted" : "model_stop_proposal_validated",
    operations: operation ? [operation] : [],
    skippedDuplicateOperationIds: [],
    consideredQuestionIds: [...input.deterministicPlan.consideredQuestionIds],
    consideredHypothesisIds: [...input.deterministicPlan.consideredHypothesisIds],
    consideredKnowledgeGapIds: [...input.deterministicPlan.consideredKnowledgeGapIds],
    synthesizedOperationSources: [],
    productive: operation !== null,
  };
}
