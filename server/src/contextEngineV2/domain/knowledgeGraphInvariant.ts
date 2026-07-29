import type {
  RepositoryEntity,
  RepositorySnapshot,
} from "../contracts/index.js";
import { isJsonSafeValue, InvariantViolationError } from "./invariant.js";
import { containsSecretLikeSemanticValue } from "./semanticLiteralSafety.js";
import type { ContractValidationIssue } from "./validationTypes.js";

const ENTITY_KINDS = new Set([
  "repository",
  "file",
  "directory",
  "module",
  "symbol",
  "function",
  "class",
  "interface",
  "type",
  "component",
  "route",
  "endpoint",
  "configuration_key",
  "database_entity",
  "state_store",
  "event",
  "test_case",
  "external_dependency",
  "literal",
  "unknown",
]);

const ENTITY_FIELDS = new Set([
  "id",
  "snapshotId",
  "kind",
  "displayName",
  "canonicalName",
  "fileId",
  "attributes",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnknownEnumerableField(
  value: object,
  allowedFields: ReadonlySet<string>,
): boolean {
  return Reflect.ownKeys(value).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(
      descriptor?.enumerable &&
        (typeof key !== "string" || !allowedFields.has(key)),
    );
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertRepositoryEntitySnapshotConsistency(
  entity: RepositoryEntity,
  snapshot: RepositorySnapshot,
): void {
  const issues: ContractValidationIssue[] = [];
  const raw = entity as unknown;
  if (!isRecord(raw)) {
    throw new InvariantViolationError([
      {
        path: "entity",
        code: "invalid_type",
        message: "Repository entity must be an object.",
      },
    ]);
  }
  if (hasUnknownEnumerableField(raw, ENTITY_FIELDS)) {
    issues.push({
      path: "entity",
      code: "invalid_value",
      message: "Repository entity contains unsupported fields.",
    });
  }
  if (!isNonEmptyString(raw.id)) {
    issues.push({
      path: "entity.id",
      code: "required",
      message: "Entity id is required.",
    });
  }
  if (raw.snapshotId !== snapshot.id) {
    issues.push({
      path: "entity.snapshotId",
      code: "snapshot_mismatch",
      message: "Entity must belong to the active snapshot.",
    });
  }
  if (typeof raw.kind !== "string" || !ENTITY_KINDS.has(raw.kind)) {
    issues.push({
      path: "entity.kind",
      code: "invalid_value",
      message: "Entity kind is not supported.",
    });
  }
  if (!isNonEmptyString(raw.displayName)) {
    issues.push({
      path: "entity.displayName",
      code: "required",
      message: "Entity display name is required.",
    });
  }
  if (raw.canonicalName !== undefined && !isNonEmptyString(raw.canonicalName)) {
    issues.push({
      path: "entity.canonicalName",
      code: "invalid_type",
      message: "Entity canonical name must be a non-empty string when provided.",
    });
  }
  if (
    containsSecretLikeSemanticValue(raw.id) ||
    containsSecretLikeSemanticValue(raw.displayName) ||
    containsSecretLikeSemanticValue(raw.canonicalName) ||
    containsSecretLikeSemanticValue(raw.attributes)
  ) {
    issues.push({
      path: "entity",
      code: "invalid_value",
      message: "Secret-like semantic entity values cannot be stored.",
    });
  }
  if (raw.fileId !== undefined) {
    if (!isNonEmptyString(raw.fileId)) {
      issues.push({
        path: "entity.fileId",
        code: "invalid_type",
        message: "Entity file id must be a non-empty string when provided.",
      });
    } else if (!snapshot.files.some((file) => file.id === raw.fileId)) {
      issues.push({
        path: "entity.fileId",
        code: "unknown_reference",
        message: "Entity file must exist in the active snapshot.",
      });
    }
  }
  if (
    raw.attributes !== undefined &&
    (!isRecord(raw.attributes) || !isJsonSafeValue(raw.attributes))
  ) {
    issues.push({
      path: "entity.attributes",
      code: "not_json_safe",
      message: "Entity attributes must be a JSON-safe object.",
    });
  }
  if (issues.length > 0) {
    throw new InvariantViolationError(issues);
  }
}
