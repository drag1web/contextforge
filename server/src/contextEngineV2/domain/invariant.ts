import type {
  ContractValidationIssue,
  ContractValidationResult,
} from "./validationTypes.js";
import type {
  EvidenceRecord,
  FactRecord,
  Finding,
  InvestigationRequest,
  JsonValue,
  RepositorySnapshot,
  SourceSpan,
} from "../contracts/index.js";

const PURPOSES = new Set([
  "implementation_context",
  "review_context",
  "clarification",
  "shadow_comparison",
]);

const SNAPSHOT_SOURCES = new Set([
  "legacy_inventory_adapter",
  "local_repository",
  "remote_repository",
  "test_fixture",
]);

const FILE_KINDS = new Set([
  "source",
  "test",
  "configuration",
  "documentation",
  "asset",
  "generated",
  "data",
  "unknown",
]);

const SECRET_RISKS = new Set(["none", "possible", "known"]);

const TRUNCATION_REASONS = new Set([
  "file_limit",
  "byte_limit",
  "permission_denied",
  "unsupported_source",
  "adapter_limit",
]);

const PRIOR_KNOWLEDGE_SOURCES = new Set([
  "repository_metadata",
  "user_provided",
  "previous_investigation",
]);

const BUDGET_FIELDS = [
  "maxOperations",
  "maxFileReads",
  "maxFileBytes",
  "maxParsedFiles",
  "maxRelationshipHops",
  "maxWallTimeMs",
  "maxPlannerRounds",
  "maxConcurrentOperations",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      return false;
    }
  }
  return true;
}

function isJsonSafeValueInternal(
  value: unknown,
  ancestors: WeakSet<object>,
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value !== "object") {
    return false;
  }

  try {
    if (ancestors.has(value)) {
      return false;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return false;
    }
    ancestors.add(value);

    if (Array.isArray(value)) {
      const propertyNames = Object.getOwnPropertyNames(value);
      if (
        propertyNames.length !== value.length + 1 ||
        !propertyNames.includes("length")
      ) {
        ancestors.delete(value);
        return false;
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          !descriptor ||
          !descriptor.enumerable ||
          !("value" in descriptor) ||
          !isJsonSafeValueInternal(descriptor.value, ancestors)
        ) {
          ancestors.delete(value);
          return false;
        }
      }
      ancestors.delete(value);
      return true;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      ancestors.delete(value);
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if (
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        !isJsonSafeValueInternal(descriptor.value, ancestors)
      ) {
        ancestors.delete(value);
        return false;
      }
    }
    ancestors.delete(value);
    return true;
  } catch {
    ancestors.delete(value);
    return false;
  }
}

export function isJsonSafeValue(value: unknown): value is JsonValue {
  return isJsonSafeValueInternal(value, new WeakSet<object>());
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isRepositoryRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 && segment !== "." && segment !== "..",
    );
}

function issue(
  issues: ContractValidationIssue[],
  path: string,
  code: ContractValidationIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

export function validateRepositorySnapshot(
  value: unknown,
): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];
  if (!isRecord(value)) {
    issue(issues, "snapshot", "invalid_type", "Snapshot must be an object.");
    return { valid: false, issues };
  }

  if (!isNonEmptyString(value.id)) {
    issue(issues, "snapshot.id", "required", "Snapshot id is required.");
  }
  if (!isNonEmptyString(value.projectId)) {
    issue(
      issues,
      "snapshot.projectId",
      "required",
      "Snapshot projectId is required.",
    );
  }
  if (!isNonEmptyString(value.rootUri)) {
    issue(
      issues,
      "snapshot.rootUri",
      "required",
      "Snapshot rootUri is required.",
    );
  }
  if (!isNonEmptyString(value.rootFingerprint)) {
    issue(
      issues,
      "snapshot.rootFingerprint",
      "required",
      "Snapshot rootFingerprint is required.",
    );
  }
  if (typeof value.source !== "string" || !SNAPSHOT_SOURCES.has(value.source)) {
    issue(
      issues,
      "snapshot.source",
      "invalid_value",
      "Snapshot source is not supported.",
    );
  }
  if (
    !isNonEmptyString(value.createdAt) ||
    Number.isNaN(Date.parse(value.createdAt))
  ) {
    issue(
      issues,
      "snapshot.createdAt",
      "invalid_value",
      "Snapshot createdAt must be an ISO-compatible timestamp.",
    );
  }

  if (!isDenseArray(value.files)) {
    issue(
      issues,
      "snapshot.files",
      Array.isArray(value.files) ? "invalid_value" : "invalid_type",
      "Snapshot files must be a dense array.",
    );
  } else {
    const fileIds = new Set<string>();
    const normalizedPaths = new Set<string>();
    value.files.forEach((file, index) => {
      const path = `snapshot.files[${index}]`;
      if (!isRecord(file)) {
        issue(issues, path, "invalid_type", "File descriptor must be an object.");
        return;
      }
      if (!isNonEmptyString(file.id)) {
        issue(issues, `${path}.id`, "required", "File id is required.");
      } else if (fileIds.has(file.id)) {
        issue(issues, `${path}.id`, "duplicate", "File ids must be unique.");
      } else {
        fileIds.add(file.id);
      }
      if (file.snapshotId !== value.id) {
        issue(
          issues,
          `${path}.snapshotId`,
          "snapshot_mismatch",
          "File must belong to the containing snapshot.",
        );
      }
      if (
        !isNonEmptyString(file.path) ||
        !isRepositoryRelativePath(file.path)
      ) {
        issue(
          issues,
          `${path}.path`,
          "unsafe_path",
          "File path must be repository-relative POSIX form.",
        );
      }
      if (
        !isNonEmptyString(file.normalizedPath) ||
        !isRepositoryRelativePath(file.normalizedPath)
      ) {
        issue(
          issues,
          `${path}.normalizedPath`,
          "unsafe_path",
          "File path must be normalized repository-relative POSIX form.",
        );
      } else if (normalizedPaths.has(file.normalizedPath)) {
        issue(
          issues,
          `${path}.normalizedPath`,
          "duplicate",
          "Normalized file paths must be unique within a snapshot.",
        );
      } else {
        normalizedPaths.add(file.normalizedPath);
      }
      if (!isNonEmptyString(file.contentFingerprint)) {
        issue(
          issues,
          `${path}.contentFingerprint`,
          "required",
          "File content fingerprint is required.",
        );
      }
      if (typeof file.kind !== "string" || !FILE_KINDS.has(file.kind)) {
        issue(
          issues,
          `${path}.kind`,
          "invalid_value",
          "File kind is not supported.",
        );
      }
      if (!isNonNegativeInteger(file.sizeBytes)) {
        issue(
          issues,
          `${path}.sizeBytes`,
          "invalid_value",
          "File size must be a non-negative integer.",
        );
      }
      if (file.extension !== null && typeof file.extension !== "string") {
        issue(
          issues,
          `${path}.extension`,
          "invalid_type",
          "File extension must be a string or null.",
        );
      }
      if (file.language !== null && typeof file.language !== "string") {
        issue(
          issues,
          `${path}.language`,
          "invalid_type",
          "File language must be a string or null.",
        );
      }
      if (typeof file.readable !== "boolean") {
        issue(
          issues,
          `${path}.readable`,
          "invalid_type",
          "File readable flag must be boolean.",
        );
      }
      if (typeof file.generated !== "boolean") {
        issue(
          issues,
          `${path}.generated`,
          "invalid_type",
          "File generated flag must be boolean.",
        );
      }
      if (
        typeof file.secretRisk !== "string" ||
        !SECRET_RISKS.has(file.secretRisk)
      ) {
        issue(
          issues,
          `${path}.secretRisk`,
          "invalid_value",
          "File secret risk is not supported.",
        );
      }
      if (!isRecord(file.attributes) || !isJsonSafeValue(file.attributes)) {
        issue(
          issues,
          `${path}.attributes`,
          "not_json_safe",
          "File attributes must be a JSON-safe plain object.",
        );
      }
    });
  }

  if (!isRecord(value.limits)) {
    issue(
      issues,
      "snapshot.limits",
      "invalid_type",
      "Snapshot limits are required.",
    );
  } else {
    if (!isDenseArray(value.limits.excludedPatterns)) {
      issue(
        issues,
        "snapshot.limits.excludedPatterns",
        Array.isArray(value.limits.excludedPatterns)
          ? "invalid_value"
          : "invalid_type",
        "Excluded patterns must be a dense array.",
      );
    } else {
      value.limits.excludedPatterns.forEach((pattern, index) => {
        if (typeof pattern !== "string") {
          issue(
            issues,
            `snapshot.limits.excludedPatterns[${index}]`,
            "invalid_type",
            "Excluded patterns must contain only strings.",
          );
        }
      });
    }
    for (const optionalLimit of ["maxFiles", "maxBytes"] as const) {
      const limit = value.limits[optionalLimit];
      if (limit !== undefined && !isPositiveInteger(limit)) {
        issue(
          issues,
          `snapshot.limits.${optionalLimit}`,
          "invalid_value",
          "Snapshot limits must be positive integers when present.",
        );
      }
    }
  }

  if (!isRecord(value.truncation)) {
    issue(
      issues,
      "snapshot.truncation",
      "invalid_type",
      "Snapshot truncation state is required.",
    );
  } else {
    if (typeof value.truncation.truncated !== "boolean") {
      issue(
        issues,
        "snapshot.truncation.truncated",
        "invalid_type",
        "Snapshot truncated flag must be boolean.",
      );
    }
    if (!isDenseArray(value.truncation.reasons)) {
      issue(
        issues,
        "snapshot.truncation.reasons",
        Array.isArray(value.truncation.reasons)
          ? "invalid_value"
          : "invalid_type",
        "Snapshot truncation reasons must be a dense array.",
      );
    } else {
      value.truncation.reasons.forEach((reason, index) => {
        if (typeof reason !== "string" || !TRUNCATION_REASONS.has(reason)) {
          issue(
            issues,
            `snapshot.truncation.reasons[${index}]`,
            "invalid_value",
            "Snapshot truncation reason is not supported.",
          );
        }
      });
      if (value.truncation.truncated && value.truncation.reasons.length === 0) {
        issue(
          issues,
          "snapshot.truncation.reasons",
          "required",
          "A truncated snapshot must provide at least one reason.",
        );
      }
      if (!value.truncation.truncated && value.truncation.reasons.length > 0) {
        issue(
          issues,
          "snapshot.truncation.reasons",
          "invalid_value",
          "A complete snapshot cannot provide truncation reasons.",
        );
      }
    }
    if (
      value.truncation.omittedPathCount !== undefined &&
      !isNonNegativeInteger(value.truncation.omittedPathCount)
    ) {
      issue(
        issues,
        "snapshot.truncation.omittedPathCount",
        "invalid_value",
        "Omitted path count must be a non-negative integer.",
      );
    }
  }
  if (!isRecord(value.metadata) || !isJsonSafeValue(value.metadata)) {
    issue(
      issues,
      "snapshot.metadata",
      "not_json_safe",
      "Snapshot metadata must be a JSON-safe plain object.",
    );
  }

  return { valid: issues.length === 0, issues };
}

export function validateInvestigationRequest(
  value: unknown,
): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];
  if (!isRecord(value)) {
    issue(issues, "request", "invalid_type", "Request must be an object.");
    return { valid: false, issues };
  }

  if (!isNonEmptyString(value.requestId)) {
    issue(issues, "requestId", "required", "Request id is required.");
  }
  if (!isNonEmptyString(value.projectId)) {
    issue(issues, "projectId", "required", "Project id is required.");
  }
  if (!isRecord(value.task) || !isNonEmptyString(value.task.normalizedTask)) {
    issue(
      issues,
      "task.normalizedTask",
      "required",
      "A normalized task is required.",
    );
  }
  if (!isRecord(value.snapshot)) {
    issue(issues, "snapshot", "invalid_type", "Snapshot is required.");
  } else {
    issues.push(...validateRepositorySnapshot(value.snapshot).issues);
    if (
      isNonEmptyString(value.projectId) &&
      value.snapshot.projectId !== value.projectId
    ) {
      issue(
        issues,
        "snapshot.projectId",
        "snapshot_mismatch",
        "Request and snapshot project ids must match.",
      );
    }
  }
  if (!isDenseArray(value.explicitTargets)) {
    issue(
      issues,
      "explicitTargets",
      Array.isArray(value.explicitTargets) ? "invalid_value" : "invalid_type",
      "Explicit targets must be a dense array.",
    );
  } else {
    value.explicitTargets.forEach((target, index) => {
      const path = `explicitTargets[${index}]`;
      if (!isRecord(target)) {
        issue(issues, path, "invalid_type", "Explicit target must be an object.");
      } else if (target.kind === "path") {
        if (
          !isNonEmptyString(target.path) ||
          !isRepositoryRelativePath(target.path)
        ) {
          issue(
            issues,
            `${path}.path`,
            "unsafe_path",
            "Explicit paths must be repository-relative POSIX paths.",
          );
        }
      } else if (target.kind === "symbol") {
        if (!isNonEmptyString(target.symbol)) {
          issue(
            issues,
            `${path}.symbol`,
            "required",
            "Explicit symbol is required.",
          );
        }
      } else {
        issue(
          issues,
          `${path}.kind`,
          "invalid_value",
          "Explicit target kind is not supported.",
        );
      }
    });
  }
  if (!isDenseArray(value.negativeConstraints)) {
    issue(
      issues,
      "negativeConstraints",
      Array.isArray(value.negativeConstraints)
        ? "invalid_value"
        : "invalid_type",
      "Negative constraints must be a dense array.",
    );
  } else {
    value.negativeConstraints.forEach((constraint, index) => {
      const path = `negativeConstraints[${index}]`;
      if (!isRecord(constraint)) {
        issue(
          issues,
          path,
          "invalid_type",
          "Negative constraint must be an object.",
        );
      } else if (
        constraint.kind === "path" &&
        !isNonEmptyString(constraint.pattern)
      ) {
        issue(
          issues,
          `${path}.pattern`,
          "required",
          "Negative path pattern is required.",
        );
      } else if (
        constraint.kind === "semantic" &&
        !isNonEmptyString(constraint.description)
      ) {
        issue(
          issues,
          `${path}.description`,
          "required",
          "Negative semantic description is required.",
        );
      } else if (constraint.kind !== "path" && constraint.kind !== "semantic") {
        issue(
          issues,
          `${path}.kind`,
          "invalid_value",
          "Negative constraint kind is not supported.",
        );
      }
    });
  }
  if (value.priorKnowledge !== undefined) {
    if (!isDenseArray(value.priorKnowledge)) {
      issue(
        issues,
        "priorKnowledge",
        Array.isArray(value.priorKnowledge) ? "invalid_value" : "invalid_type",
        "Prior knowledge references must be a dense array.",
      );
    } else {
      value.priorKnowledge.forEach((reference, index) => {
        const path = `priorKnowledge[${index}]`;
        if (!isRecord(reference)) {
          issue(
            issues,
            path,
            "invalid_type",
            "Prior knowledge reference must be an object.",
          );
        } else {
          if (!isNonEmptyString(reference.referenceId)) {
            issue(
              issues,
              `${path}.referenceId`,
              "required",
              "Prior knowledge reference id is required.",
            );
          }
          if (
            typeof reference.source !== "string" ||
            !PRIOR_KNOWLEDGE_SOURCES.has(reference.source)
          ) {
            issue(
              issues,
              `${path}.source`,
              "invalid_value",
              "Prior knowledge source is not supported.",
            );
          }
        }
      });
    }
  }
  if (!isRecord(value.budget)) {
    issue(issues, "budget", "invalid_type", "Budget is required.");
  } else {
    for (const field of BUDGET_FIELDS) {
      if (!isPositiveInteger(value.budget[field])) {
        issue(
          issues,
          `budget.${field}`,
          "invalid_value",
          "Budget values must be positive integers.",
        );
      }
    }
  }
  if (typeof value.purpose !== "string" || !PURPOSES.has(value.purpose)) {
    issue(
      issues,
      "purpose",
      "invalid_value",
      "Investigation purpose is not supported.",
    );
  }

  return { valid: issues.length === 0, issues };
}

function collectSourceSpanIssues(
  span: SourceSpan,
  snapshot: RepositorySnapshot,
  path: string,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  const file = snapshot.files.find((candidate) => candidate.id === span.fileId);
  if (span.snapshotId !== snapshot.id) {
    issue(
      issues,
      `${path}.snapshotId`,
      "snapshot_mismatch",
      "Source span must belong to the active snapshot.",
    );
  }
  if (!file) {
    issue(
      issues,
      `${path}.fileId`,
      "unknown_reference",
      "Source span must reference a snapshot file.",
    );
  } else {
    if (file.normalizedPath !== span.path) {
      issue(
        issues,
        `${path}.path`,
        "invalid_value",
        "Source span path must match its file descriptor.",
      );
    }
    if (file.contentFingerprint !== span.contentFingerprint) {
      issue(
        issues,
        `${path}.contentFingerprint`,
        "invalid_value",
        "Source span fingerprint must match its file descriptor.",
      );
    }
  }
  const coordinates = [
    span.startLine,
    span.startColumn,
    span.endLine,
    span.endColumn,
  ];
  if (
    coordinates.some(
      (coordinate) =>
        !Number.isFinite(coordinate) ||
        !Number.isInteger(coordinate) ||
        coordinate < 1,
    ) ||
    span.endLine < span.startLine ||
    (span.endLine === span.startLine && span.endColumn < span.startColumn)
  ) {
    issue(
      issues,
      path,
      "invalid_range",
      "Source span must use a valid one-based range.",
    );
  }
  return issues;
}

function collectFactSnapshotConsistencyIssues(
  fact: FactRecord,
  snapshot: RepositorySnapshot,
  path: string,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  if (fact.snapshotId !== snapshot.id || fact.subject.snapshotId !== snapshot.id) {
    issue(
      issues,
      `${path}.snapshotId`,
      "snapshot_mismatch",
      "Fact and subject must belong to the active snapshot.",
    );
  }
  if (fact.kind === "relation" && fact.object.snapshotId !== snapshot.id) {
    issue(
      issues,
      `${path}.object.snapshotId`,
      "snapshot_mismatch",
      "Relation object must belong to the active snapshot.",
    );
  }
  if (fact.source.kind === "source_span") {
    issues.push(
      ...collectSourceSpanIssues(fact.source, snapshot, `${path}.source`),
    );
  } else if (fact.source.snapshotId !== snapshot.id) {
    issue(
      issues,
      `${path}.source.snapshotId`,
      "snapshot_mismatch",
      "Metadata source must belong to the active snapshot.",
    );
  }
  if (
    fact.provenance.method === "derived" &&
    (!fact.provenance.parentFactIds || fact.provenance.parentFactIds.length === 0)
  ) {
    issue(
      issues,
      `${path}.provenance.parentFactIds`,
      "required",
      "Derived facts must reference parent facts.",
    );
  }
  const provenanceMethod = (fact.provenance as { method?: unknown }).method;
  if (provenanceMethod === "model_proposed") {
    issue(
      issues,
      `${path}.provenance.method`,
      "invalid_value",
      "Model proposals cannot be stored as facts.",
    );
  }
  if (!isRecord(fact.attributes) || !isJsonSafeValue(fact.attributes)) {
    issue(
      issues,
      `${path}.attributes`,
      "not_json_safe",
      "Fact attributes must be a JSON-safe plain object.",
    );
  }
  if (fact.kind === "fact") {
    if (
      fact.object.type === "number" &&
      !Number.isFinite(fact.object.value)
    ) {
      issue(
        issues,
        `${path}.object.value`,
        "not_json_safe",
        "Numeric fact literals must be finite.",
      );
    }
    if (
      fact.object.type === "json" &&
      !isJsonSafeValue(fact.object.value)
    ) {
      issue(
        issues,
        `${path}.object.value`,
        "not_json_safe",
        "JSON fact literals must be JSON-safe.",
      );
    }
  }
  return issues;
}

export class InvariantViolationError extends Error {
  readonly code = "invariant_violation";

  constructor(readonly issues: ContractValidationIssue[]) {
    super(issues.map((entry) => `${entry.path}: ${entry.message}`).join("; "));
    this.name = "InvariantViolationError";
  }
}

export function assertFactSnapshotConsistency(
  fact: FactRecord,
  snapshot: RepositorySnapshot,
): void {
  const issues = collectFactSnapshotConsistencyIssues(fact, snapshot, "fact");
  if (issues.length > 0) {
    throw new InvariantViolationError(issues);
  }
}

export function assertEvidenceSnapshotConsistency(
  evidence: EvidenceRecord,
  facts: readonly FactRecord[],
  snapshot: RepositorySnapshot,
): void {
  const issues: ContractValidationIssue[] = [];
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  if (
    evidence.snapshotId !== snapshot.id ||
    evidence.freshness.snapshotId !== snapshot.id
  ) {
    issue(
      issues,
      "evidence.snapshotId",
      "snapshot_mismatch",
      "Evidence and freshness must belong to the active snapshot.",
    );
  }
  const currentCompatibleReasons = new Set(["snapshot_match", "fingerprint_match"]);
  if (
    evidence.freshness.current &&
    !currentCompatibleReasons.has(evidence.freshness.reason ?? "")
  ) {
    issue(
      issues,
      "evidence.freshness",
      "invalid_value",
      "Current evidence requires a snapshot or fingerprint match reason.",
    );
  }
  if (
    !evidence.freshness.current &&
    currentCompatibleReasons.has(evidence.freshness.reason ?? "")
  ) {
    issue(
      issues,
      "evidence.freshness",
      "invalid_value",
      "Snapshot or fingerprint match reasons require current evidence.",
    );
  }
  evidence.factIds.forEach((factId, index) => {
    const referencedFact = factsById.get(factId);
    if (!referencedFact) {
      issue(
        issues,
        `evidence.factIds[${index}]`,
        "unknown_reference",
        `Evidence references unknown fact ${factId}.`,
      );
    } else {
      issues.push(
        ...collectFactSnapshotConsistencyIssues(
          referencedFact,
          snapshot,
          `evidence.factIds[${index}]`,
        ),
      );
    }
  });
  evidence.sourceSpans.forEach((span, index) => {
    issues.push(
      ...collectSourceSpanIssues(span, snapshot, `evidence.sourceSpans[${index}]`),
    );
  });
  if (evidence.factIds.length === 0 && evidence.sourceSpans.length === 0) {
    issue(
      issues,
      "evidence",
      "required",
      "Evidence must reference a fact or source span.",
    );
  }
  if (issues.length > 0) {
    throw new InvariantViolationError(issues);
  }
}

export function assertFindingEvidenceConsistency(
  finding: Finding,
  evidence: readonly EvidenceRecord[],
  snapshot: RepositorySnapshot,
): void {
  const issues: ContractValidationIssue[] = [];
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));
  if (finding.snapshotId !== snapshot.id) {
    issue(
      issues,
      "finding.snapshotId",
      "snapshot_mismatch",
      "Finding must belong to the active snapshot.",
    );
  }
  if (finding.status === "confirmed" && finding.evidenceIds.length === 0) {
    issue(
      issues,
      "finding.evidenceIds",
      "required",
      "Confirmed findings require evidence.",
    );
  }
  for (const evidenceId of finding.evidenceIds) {
    const record = evidenceById.get(evidenceId);
    if (!record) {
      issue(
        issues,
        "finding.evidenceIds",
        "unknown_reference",
        `Finding references unknown evidence ${evidenceId}.`,
      );
    } else if (!record.freshness.current) {
      issue(
        issues,
        "finding.evidenceIds",
        "stale_evidence",
        `Finding references stale evidence ${evidenceId}.`,
      );
    } else if (
      record.snapshotId !== snapshot.id ||
      record.freshness.snapshotId !== snapshot.id
    ) {
      issue(
        issues,
        "finding.evidenceIds",
        "snapshot_mismatch",
        `Finding references evidence from another snapshot ${evidenceId}.`,
      );
    }
  }
  if (
    finding.status === "confirmed" &&
    !finding.evidenceIds.some((evidenceId) => {
      const record = evidenceById.get(evidenceId);
      return record?.role === "supports" && record.strength !== "lead";
    })
  ) {
    issue(
      issues,
      "finding.evidenceIds",
      "invalid_value",
      "Confirmed findings require supporting evidence stronger than a lead.",
    );
  }
  if (issues.length > 0) {
    throw new InvariantViolationError(issues);
  }
}

export function assertValidInvestigationRequest(
  request: InvestigationRequest,
): void {
  const validation = validateInvestigationRequest(request);
  if (!validation.valid) {
    throw new InvariantViolationError(validation.issues);
  }
}
