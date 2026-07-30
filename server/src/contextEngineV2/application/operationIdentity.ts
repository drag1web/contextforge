import type {
  InvestigationOperation,
  InvestigationOperationType,
  SnapshotId,
} from "../contracts/index.js";
import { isRepositoryRelativePath } from "../domain/invariant.js";
import {
  InvestigationDomainError,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeInteger,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  stableSerialize,
} from "../domain/investigationDomainSupport.js";
import { InvestigationRunnerError } from "./investigationRunnerTypes.js";

type OperationSeed = {
  [Type in InvestigationOperationType]: Omit<
    Extract<InvestigationOperation, { type: Type }>,
    "id" | "deduplicationKey"
  >;
}[InvestigationOperationType];

const BASE_FIELDS = [
  "id",
  "type",
  "reason",
  "questionIds",
  "hypothesisIds",
  "priority",
  "estimatedCost",
  "deduplicationKey",
  "safetyClassification",
] as const;
const COST_FIELDS = [
  "operations",
  "fileReads",
  "fileBytes",
  "parsedFiles",
  "relationshipHops",
  "plannerRounds",
  "wallTimeMs",
] as const;
const TYPE_FIELDS: Readonly<Record<InvestigationOperationType, readonly string[]>> = {
  search_paths: ["query"],
  search_text: ["query"],
  search_symbols: ["query"],
  read_file: ["path"],
  read_range: ["path", "startLine", "endLine"],
  parse_file: ["path"],
  follow_relationship: ["fromEntityId", "predicates", "maxHops"],
  inspect_manifest: ["path"],
  inspect_git_context: ["paths"],
  evaluate_absence: ["query", "scopes"],
};
const OPERATION_TYPES = new Set<InvestigationOperationType>(
  Object.keys(TYPE_FIELDS) as InvestigationOperationType[],
);
const SAFETY = new Set(["safe", "restricted", "blocked"]);

function hashText(value: string): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right
    .toString(16)
    .padStart(8, "0")}`;
}

export function deterministicApplicationId(prefix: string, value: unknown): string {
  assertPortableIdentifier(prefix, "Deterministic id prefix");
  return `${prefix}-${hashText(stableSerialize(value))}`;
}

function semanticTarget(operation: InvestigationOperation): unknown {
  switch (operation.type) {
    case "search_paths":
    case "search_text":
    case "search_symbols":
      return { query: operation.query };
    case "read_file":
    case "parse_file":
    case "inspect_manifest":
      return { path: operation.path };
    case "read_range":
      return {
        path: operation.path,
        startLine: operation.startLine,
        endLine: operation.endLine,
      };
    case "follow_relationship":
      return {
        fromEntityId: operation.fromEntityId,
        maxHops: operation.maxHops,
        predicates: operation.predicates,
      };
    case "inspect_git_context":
      return { paths: operation.paths };
    case "evaluate_absence":
      return { query: operation.query, scopes: operation.scopes };
  }
}

export function operationIdentity(
  snapshotId: SnapshotId,
  operation: InvestigationOperation,
): { id: InvestigationOperation["id"]; deduplicationKey: string } {
  const digest = hashText(
    stableSerialize({
      snapshotId,
      type: operation.type,
      target: semanticTarget(operation),
    }),
  );
  return {
    id: `operation-${digest}` as InvestigationOperation["id"],
    deduplicationKey: `operation-${digest}`,
  };
}

export function operationExecutionKey(
  snapshotId: SnapshotId,
  operation: InvestigationOperation,
): string {
  return operationIdentity(snapshotId, operation).deduplicationKey;
}

export function createDeterministicOperation(
  snapshotId: SnapshotId,
  seed: OperationSeed,
): InvestigationOperation {
  const temporary = {
    ...cloneDomainValue(seed),
    id: "operation-placeholder",
    deduplicationKey: "operation-placeholder",
  } as InvestigationOperation;
  const identity = operationIdentity(snapshotId, temporary);
  return {
    ...temporary,
    ...identity,
  } as InvestigationOperation;
}

function assertPath(value: unknown, label: string): asserts value is string {
  assertSafeText(value, label);
  if (!isRepositoryRelativePath(value)) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${label} must be a normalized repository-relative POSIX path.`,
    );
  }
}

export function validateOperation(
  rawOperation: InvestigationOperation,
  snapshotId: SnapshotId,
): InvestigationOperation {
  const operation = cloneDomainValue(rawOperation);
  if (!OPERATION_TYPES.has(operation.type)) {
    throw new InvestigationRunnerError(
      "invalid_input",
      "Investigation operation type is unsupported.",
    );
  }
  const fields = [...BASE_FIELDS, ...TYPE_FIELDS[operation.type]];
  assertClosedRecord(operation, fields, fields, "Investigation operation");
  assertPortableIdentifier(operation.id, "Investigation operation id");
  assertPortableIdentifier(
    operation.deduplicationKey,
    "Investigation operation deduplication key",
  );
  assertSafeText(operation.reason, "Investigation operation reason");
  assertSortedUniqueStrings(operation.questionIds, "Operation question ids");
  assertSortedUniqueStrings(operation.hypothesisIds, "Operation hypothesis ids");
  operation.questionIds.forEach((id) =>
    assertPortableIdentifier(id, "Operation question id"),
  );
  operation.hypothesisIds.forEach((id) =>
    assertPortableIdentifier(id, "Operation hypothesis id"),
  );
  assertSafeInteger(operation.priority, "Operation priority");
  if (!SAFETY.has(operation.safetyClassification)) {
    throw new InvestigationRunnerError(
      "invalid_input",
      "Investigation operation safety classification is unsupported.",
    );
  }
  assertClosedRecord(
    operation.estimatedCost,
    COST_FIELDS,
    COST_FIELDS,
    "Operation estimated cost",
  );
  COST_FIELDS.forEach((field) =>
    assertSafeInteger(operation.estimatedCost[field], `Operation cost ${field}`),
  );
  switch (operation.type) {
    case "search_paths":
    case "search_text":
    case "search_symbols":
      assertSafeText(operation.query, "Operation query");
      break;
    case "read_file":
    case "parse_file":
    case "inspect_manifest":
      assertPath(operation.path, "Operation path");
      break;
    case "read_range":
      assertPath(operation.path, "Operation path");
      assertSafeInteger(operation.startLine, "Read range start line", { positive: true });
      assertSafeInteger(operation.endLine, "Read range end line", { positive: true });
      if (operation.endLine < operation.startLine) {
        throw new InvestigationRunnerError(
          "invalid_input",
          "Read range end line must not precede its start line.",
        );
      }
      break;
    case "follow_relationship":
      assertPortableIdentifier(operation.fromEntityId, "Relationship source entity id");
      assertSortedUniqueStrings(operation.predicates, "Relationship predicates");
      operation.predicates.forEach((predicate) =>
        assertSafeText(predicate, "Relationship predicate"),
      );
      assertSafeInteger(operation.maxHops, "Relationship hop limit", { positive: true });
      break;
    case "inspect_git_context":
      assertSortedUniqueStrings(operation.paths, "Git context paths");
      operation.paths.forEach((path) => assertPath(path, "Git context path"));
      break;
    case "evaluate_absence":
      assertSafeText(operation.query, "Absence query");
      assertSortedUniqueStrings(operation.scopes, "Absence scopes");
      operation.scopes.forEach((scope) => assertPath(scope, "Absence scope"));
      break;
  }
  const expected = operationIdentity(snapshotId, operation);
  if (
    operation.id !== expected.id ||
    operation.deduplicationKey !== expected.deduplicationKey
  ) {
    throw new InvestigationRunnerError(
      "operation_conflict",
      "Investigation operation identity does not match its semantic target.",
    );
  }
  return operation;
}

export function operationTargetKey(operation: InvestigationOperation): string {
  return stableSerialize(semanticTarget(operation));
}

const SAFETY_ORDER: Readonly<Record<InvestigationOperation["safetyClassification"], number>> = {
  safe: 0,
  restricted: 1,
  blocked: 2,
};

function mergeOperationCost(
  left: InvestigationOperation["estimatedCost"],
  right: InvestigationOperation["estimatedCost"],
): InvestigationOperation["estimatedCost"] {
  return {
    operations: Math.max(left.operations, right.operations),
    fileReads: Math.max(left.fileReads, right.fileReads),
    fileBytes: Math.max(left.fileBytes, right.fileBytes),
    parsedFiles: Math.max(left.parsedFiles, right.parsedFiles),
    relationshipHops: Math.max(left.relationshipHops, right.relationshipHops),
    plannerRounds: Math.max(left.plannerRounds, right.plannerRounds),
    wallTimeMs: Math.max(left.wallTimeMs, right.wallTimeMs),
  };
}

export function mergeCompatibleOperations(
  snapshotId: SnapshotId,
  operations: readonly InvestigationOperation[],
): InvestigationOperation[] {
  const byExecutionKey = new Map<string, InvestigationOperation>();
  for (const rawOperation of operations) {
    const operation = validateOperation(rawOperation, snapshotId);
    const executionKey = operationExecutionKey(snapshotId, operation);
    const existing = byExecutionKey.get(executionKey);
    if (!existing) {
      byExecutionKey.set(executionKey, operation);
      continue;
    }
    byExecutionKey.set(executionKey, mergeCompatibleOperationPurposes(existing, operation));
  }
  return [...byExecutionKey.values()].sort((left, right) =>
    left.deduplicationKey.localeCompare(right.deduplicationKey)
  ).map(cloneDomainValue);
}

export function mergeCompatibleOperationPurposes(
  left: InvestigationOperation,
  right: InvestigationOperation,
): InvestigationOperation {
  if (
    left.id !== right.id ||
    left.deduplicationKey !== right.deduplicationKey ||
    left.type !== right.type ||
    operationTargetKey(left) !== operationTargetKey(right)
  ) {
    throw new InvestigationRunnerError(
      "operation_conflict",
      "Operation execution key is associated with conflicting semantic targets.",
    );
  }
  const reasons = [...new Set([left.reason, right.reason])].sort();
  const safety = SAFETY_ORDER[left.safetyClassification] >=
    SAFETY_ORDER[right.safetyClassification]
    ? left.safetyClassification
    : right.safetyClassification;
  return {
    ...cloneDomainValue(left),
    reason: reasons.join(" | "),
    questionIds: [...new Set([...left.questionIds, ...right.questionIds])].sort(),
    hypothesisIds: [...new Set([...left.hypothesisIds, ...right.hypothesisIds])].sort(),
    priority: Math.max(left.priority, right.priority),
    estimatedCost: mergeOperationCost(left.estimatedCost, right.estimatedCost),
    safetyClassification: safety,
  } as InvestigationOperation;
}
