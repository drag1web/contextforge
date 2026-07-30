import type {
  ContextProjectionResult,
  FileDescriptor,
  ProjectionEntityDecision,
  RepositorySnapshot,
} from "../../contracts/index.js";
import {
  validateRepositorySnapshot,
} from "../../domain/index.js";
import {
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  sortedUnique,
  stableCompare,
} from "../../domain/investigationDomainSupport.js";
import { pathMatchesNegativeConstraints } from "../../domain/negativeConstraintMatcher.js";
import type {
  SelectedTaskFile,
  SelectedTaskFileUsage,
  TaskFileSelection,
} from "../../../ollama/taskFileSelector.js";
import { mapLegacyFileKind } from "./legacyFileKindMapper.js";
import {
  LegacyProjectionError,
  type LegacyProjectionDiagnostic,
  type LegacyProjectionFileTrace,
  type LegacyProjectionOptions,
  type LegacyProjectionResult,
  type LegacyTaskFileSelectionProjection,
} from "./legacyProjectionTypes.js";

const ROLE_PRECEDENCE = { reference: 0, supporting: 1, test: 2, target: 3 } as const;
const COMPATIBILITY_CONFIDENCE = {
  target: 0.99,
  test: 0.9,
  supporting: 0.7,
  reference: 0.5,
} as const;
const RESULT_FIELDS = ["projection", "source", "diagnostics", "decisions"] as const;
const OPTION_FIELDS = [
  "effectiveTaskArea",
  "requestedTaskType",
  "durationMs",
  "negativeConstraints",
] as const;
const PROJECTION_FIELDS = [
  "snapshotId",
  "purpose",
  "primaryEntities",
  "supportingEntities",
  "referenceEntities",
  "excludedEntities",
  "findings",
  "unresolvedQuestions",
  "evidenceSummary",
] as const;
const DECISION_FIELDS = [
  "entityId",
  "fileId",
  "path",
  "role",
  "included",
  "reviewRequired",
  "findingIds",
  "evidenceIds",
  "reasonCodes",
] as const;
const DIAGNOSTIC_FIELDS = [
  "code",
  "message",
  "entityId",
  "findingId",
  "evidenceIds",
  "path",
  "targetKey",
] as const;
const SOURCE_FIELDS = ["stopReason", "safeToProject"] as const;
const PROJECTED_ENTITY_FIELDS = [
  "entityId",
  "role",
  "reason",
  "findingIds",
  "evidenceIds",
  "reviewRequired",
] as const;
const FINDING_FIELDS = [
  "id",
  "snapshotId",
  "type",
  "statement",
  "entityIds",
  "evidenceIds",
  "status",
  "limitations",
  "authorizationHint",
] as const;
const STOP_REASONS = new Set([
  "sufficient_evidence",
  "clarification_required",
  "no_grounded_lead",
  "contradictory_evidence",
  "operation_budget_exhausted",
  "file_budget_exhausted",
  "byte_budget_exhausted",
  "time_budget_exhausted",
  "planner_round_budget_exhausted",
  "repository_snapshot_truncated",
  "repository_changed",
  "safety_blocked",
  "internal_error",
]);
const PURPOSES = new Set(["implementation", "review", "clarification", "legacy_selection"]);
const FINDING_TYPES = new Set([
  "implementation_target",
  "supporting_context",
  "behavior_summary",
  "constraint",
  "risk",
  "test_target",
  "clarification_requirement",
]);
const FINDING_STATUSES = new Set(["confirmed", "probable", "unresolved"]);
const AUTHORIZATION_HINTS = new Set(["eligible", "review_required", "not_eligible"]);
const DECISION_ROLES = new Set(["target", "supporting", "reference", "test"]);
const REASON_CODES = new Set([
  "ambiguous_entity_file",
  "blocking_contradiction",
  "blocking_gap",
  "confirmed_implementation_target",
  "confirmed_supporting_context",
  "confirmed_test_target",
  "cross_snapshot_reference",
  "evidence_entity_mismatch",
  "explicit_target_eligible",
  "explicit_target_unknown",
  "explicit_target_unresolved",
  "generated_reference_only",
  "generated_target_blocked",
  "missing_evidence",
  "negative_constraint",
  "probable_review_only",
  "result_not_safe_to_project",
  "risk_requires_review",
  "secret_file",
  "stop_reason_blocks_projection",
  "unknown_entity",
  "unreadable_file",
  "unresolved_ineligible",
]);
const EDITABLE_REASON_CODES = new Set<ProjectionEntityDecision["reasonCodes"][number]>([
  "confirmed_implementation_target",
  "confirmed_supporting_context",
  "confirmed_test_target",
  "explicit_target_eligible",
]);
const EDITABLE_BLOCKING_REASON_CODES = new Set<ProjectionEntityDecision["reasonCodes"][number]>([
  "ambiguous_entity_file",
  "blocking_contradiction",
  "blocking_gap",
  "cross_snapshot_reference",
  "evidence_entity_mismatch",
  "explicit_target_unknown",
  "explicit_target_unresolved",
  "generated_reference_only",
  "generated_target_blocked",
  "missing_evidence",
  "negative_constraint",
  "probable_review_only",
  "result_not_safe_to_project",
  "risk_requires_review",
  "secret_file",
  "stop_reason_blocks_projection",
  "unknown_entity",
  "unreadable_file",
  "unresolved_ineligible",
]);
const FINDING_BLOCKING_LIMITATIONS = new Set([
  "blocking_authorization_gap",
  "blocking_contradiction",
  "blocking_finding_gap",
  "blocking_projection_gap",
  "cross_snapshot_entity",
  "cross_snapshot_evidence",
  "current_supporting_evidence_missing",
  "implementation_entity_missing",
  "unknown_entity",
  "unknown_evidence",
]);

interface SelectedPathCandidate {
  file: FileDescriptor;
  role: LegacyProjectionFileTrace["role"];
  findingIds: string[];
  evidenceIds: string[];
  reviewRequired: boolean;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function selectedUsage(
  role: LegacyProjectionFileTrace["role"],
  file: FileDescriptor,
): SelectedTaskFileUsage {
  if (role === "target" || role === "test") return "inspect-and-edit";
  if (file.kind === "asset") return "asset-reference";
  if (file.kind === "configuration") return "config-reference";
  return "inspect-only";
}

function strongerRole(
  left: LegacyProjectionFileTrace["role"],
  right: LegacyProjectionFileTrace["role"],
): LegacyProjectionFileTrace["role"] {
  return ROLE_PRECEDENCE[left] >= ROLE_PRECEDENCE[right] ? left : right;
}

function mergeCandidate(
  candidates: Map<string, SelectedPathCandidate>,
  next: SelectedPathCandidate,
): void {
  const existing = candidates.get(next.file.normalizedPath);
  if (!existing) {
    candidates.set(next.file.normalizedPath, next);
    return;
  }
  existing.role = strongerRole(existing.role, next.role);
  existing.findingIds = sortedUnique([...existing.findingIds, ...next.findingIds]);
  existing.evidenceIds = sortedUnique([...existing.evidenceIds, ...next.evidenceIds]);
  existing.reviewRequired ||= next.reviewRequired;
}

function validateInputs(
  rawProjection: ContextProjectionResult,
  rawSnapshot: RepositorySnapshot,
  rawOptions: LegacyProjectionOptions,
): {
  projection: ContextProjectionResult;
  snapshot: RepositorySnapshot;
  options: LegacyProjectionOptions;
} {
  const projection = cloneDomainValue(rawProjection);
  const snapshot = cloneDomainValue(rawSnapshot);
  const options = cloneDomainValue(rawOptions);
  assertClosedRecord(projection, RESULT_FIELDS, RESULT_FIELDS, "Legacy projection input");
  assertClosedRecord(options, OPTION_FIELDS, ["effectiveTaskArea", "requestedTaskType", "negativeConstraints"], "Legacy projection options");
  assertSafeText(options.requestedTaskType, "Requested task type");
  if (options.durationMs !== undefined && (!Number.isFinite(options.durationMs) || options.durationMs < 0)) {
    throw new Error("invalid_duration");
  }
  if (!Array.isArray(options.negativeConstraints)) throw new Error("invalid_constraints");
  if (!validateRepositorySnapshot(snapshot).valid) throw new Error("invalid_snapshot");
  if (projection.projection.snapshotId !== snapshot.id) throw new Error("snapshot_mismatch");
  if (!Array.isArray(projection.decisions) || !Array.isArray(projection.diagnostics)) {
    throw new Error("invalid_projection_arrays");
  }
  const explicitDiagnosticKeys = new Set<string>();
  projection.diagnostics.forEach((diagnostic) => {
    assertClosedRecord(
      diagnostic,
      DIAGNOSTIC_FIELDS,
      ["code", "message", "evidenceIds"],
      "Projection diagnostic",
    );
    assertSafeText(diagnostic.message, "Projection diagnostic message");
    assertSortedUniqueStrings(diagnostic.evidenceIds, "Projection diagnostic evidence ids");
    if (!REASON_CODES.has(diagnostic.code)) throw new Error("invalid_diagnostic_code");
    const explicit = diagnostic.code === "explicit_target_eligible" ||
      diagnostic.code === "explicit_target_unresolved" ||
      diagnostic.code === "explicit_target_unknown";
    if (explicit) {
      if (
        typeof diagnostic.targetKey !== "string" ||
        (!diagnostic.targetKey.startsWith("path:") &&
          !diagnostic.targetKey.startsWith("symbol:"))
      ) {
        throw new Error("missing_explicit_target_key");
      }
      assertSafeText(diagnostic.targetKey, "Projection diagnostic target key");
      if (explicitDiagnosticKeys.has(diagnostic.targetKey)) {
        throw new Error("duplicate_explicit_target_diagnostic");
      }
      explicitDiagnosticKeys.add(diagnostic.targetKey);
    }
  });
  assertClosedRecord(
    projection.projection,
    PROJECTION_FIELDS,
    PROJECTION_FIELDS,
    "Context projection",
  );
  if (!PURPOSES.has(projection.projection.purpose)) throw new Error("invalid_projection_purpose");
  assertClosedRecord(
    projection.projection.evidenceSummary,
    ["evidenceIds", "limitations"],
    ["evidenceIds", "limitations"],
    "Projection evidence summary",
  );
  assertSortedUniqueStrings(
    projection.projection.evidenceSummary.evidenceIds,
    "Projection evidence summary ids",
  );
  assertSortedUniqueStrings(
    projection.projection.evidenceSummary.limitations,
    "Projection evidence summary limitations",
  );
  assertClosedRecord(projection.source, SOURCE_FIELDS, SOURCE_FIELDS, "Projection source");
  if (
    typeof projection.source.safeToProject !== "boolean" ||
    !STOP_REASONS.has(projection.source.stopReason)
  ) {
    throw new Error("invalid_projection_source");
  }
  const projectedGroups = [
    ["primary", projection.projection.primaryEntities, new Set(["target"])],
    ["supporting", projection.projection.supportingEntities, new Set(["supporting", "test"])],
    ["reference", projection.projection.referenceEntities, new Set(["reference"])],
  ] as const;
  const projectedByEntityId = new Map<string, ContextProjectionResult["projection"]["primaryEntities"][number]>();
  for (const [label, entries, allowedRoles] of projectedGroups) {
    if (!Array.isArray(entries)) throw new Error("invalid_projected_entities");
    for (const entry of entries) {
      assertClosedRecord(entry, PROJECTED_ENTITY_FIELDS, PROJECTED_ENTITY_FIELDS, `${label} projected entity`);
      assertPortableIdentifier(entry.entityId, "Projected entity id");
      assertSafeText(entry.reason, "Projected entity reason");
      assertSortedUniqueStrings(entry.findingIds, "Projected finding ids");
      assertSortedUniqueStrings(entry.evidenceIds, "Projected evidence ids");
      if (
        !allowedRoles.has(entry.role) ||
        typeof entry.reviewRequired !== "boolean" ||
        !REASON_CODES.has(entry.reason)
      ) {
        throw new Error("invalid_projected_role");
      }
      if (projectedByEntityId.has(entry.entityId)) throw new Error("duplicate_projected_entity");
      projectedByEntityId.set(entry.entityId, entry);
    }
  }
  const findingsById = new Map<string, ContextProjectionResult["projection"]["findings"][number]>();
  projection.projection.findings.forEach((finding) => {
    assertClosedRecord(finding, FINDING_FIELDS, FINDING_FIELDS, "Projection finding");
    assertPortableIdentifier(finding.id, "Projection finding id");
    assertSafeText(finding.statement, "Projection finding statement");
    assertSortedUniqueStrings(finding.entityIds, "Projection finding entity ids");
    assertSortedUniqueStrings(finding.evidenceIds, "Projection finding evidence ids");
    assertSortedUniqueStrings(finding.limitations, "Projection finding limitations");
    if (
      !FINDING_TYPES.has(finding.type) ||
      !FINDING_STATUSES.has(finding.status) ||
      !AUTHORIZATION_HINTS.has(finding.authorizationHint)
    ) {
      throw new Error("invalid_finding_semantics");
    }
    if (finding.snapshotId !== projection.projection.snapshotId) {
      throw new Error("cross_snapshot_finding");
    }
    if (findingsById.has(finding.id)) throw new Error("duplicate_finding");
    findingsById.set(finding.id, finding);
  });
  const findingIds = new Set(findingsById.keys());
  const evidenceIds = new Set(projection.projection.evidenceSummary.evidenceIds);
  const decisionIds = new Set<string>();
  projection.decisions.forEach((decision) => {
    assertClosedRecord(
      decision,
      DECISION_FIELDS,
      ["entityId", "included", "reviewRequired", "findingIds", "evidenceIds", "reasonCodes"],
      "Projection entity decision",
    );
    assertPortableIdentifier(decision.entityId, "Projection decision entity id");
    assertSortedUniqueStrings(decision.findingIds, "Projection decision finding ids");
    assertSortedUniqueStrings(decision.evidenceIds, "Projection decision evidence ids");
    assertSortedUniqueStrings(decision.reasonCodes, "Projection decision reason codes");
    if (
      typeof decision.included !== "boolean" ||
      typeof decision.reviewRequired !== "boolean" ||
      (decision.role !== undefined && !DECISION_ROLES.has(decision.role))
    ) {
      throw new Error("invalid_decision_semantics");
    }
    if (decision.reasonCodes.some((code) => !REASON_CODES.has(code))) {
      throw new Error("invalid_decision_reason");
    }
    if (decisionIds.has(decision.entityId)) throw new Error("duplicate_decision");
    decisionIds.add(decision.entityId);
    if (
      !Array.isArray(decision.findingIds) ||
      !Array.isArray(decision.evidenceIds) ||
      !Array.isArray(decision.reasonCodes) ||
      decision.findingIds.some((id) => !findingIds.has(id)) ||
      (decision.included && decision.evidenceIds.some((id) => !evidenceIds.has(id)))
    ) {
      throw new Error("unknown_trace_reference");
    }
    if (decision.included) {
      const projected = projectedByEntityId.get(decision.entityId);
      const decisionFindings = decision.findingIds.map((id) => findingsById.get(id)!);
      if (
        !projected ||
        projected.role !== decision.role ||
        JSON.stringify(projected.findingIds) !== JSON.stringify(decision.findingIds) ||
        JSON.stringify(projected.evidenceIds) !== JSON.stringify(decision.evidenceIds) ||
        projected.reviewRequired !== decision.reviewRequired ||
        !decision.reasonCodes.some((code) => code === projected.reason)
      ) {
        throw new Error("projection_decision_mismatch");
      }
      if (decisionFindings.some((finding) => !finding.entityIds.includes(decision.entityId))) {
        throw new Error("finding_entity_mismatch");
      }
      if (decision.evidenceIds.some((evidenceId) =>
        !decisionFindings.some((finding) => finding.evidenceIds.includes(evidenceId)))) {
        throw new Error("finding_evidence_mismatch");
      }
      if (decision.role === "target" || decision.role === "test") {
        if (
          projection.projection.purpose !== "legacy_selection" ||
          !projection.source.safeToProject ||
          projection.source.stopReason !== "sufficient_evidence" ||
          decision.reviewRequired ||
          decision.reasonCodes.some((code) => EDITABLE_BLOCKING_REASON_CODES.has(code))
        ) {
          throw new Error("unsafe_editable_projection");
        }
        const expectedFindingType = decision.role === "target"
          ? "implementation_target"
          : "test_target";
        const expectedReason = decision.role === "target"
          ? "confirmed_implementation_target"
          : "confirmed_test_target";
        const compatibleFinding = decisionFindings.some((finding) => {
          return Boolean(
            finding &&
            finding.type === expectedFindingType &&
            finding.entityIds.includes(decision.entityId) &&
            finding.status === "confirmed" &&
            finding.authorizationHint === "eligible" &&
            finding.evidenceIds.some((id) => decision.evidenceIds.includes(id)) &&
            !finding.limitations.some((limitation) =>
              FINDING_BLOCKING_LIMITATIONS.has(limitation) || limitation.startsWith("blocking_")),
          );
        });
        if (!compatibleFinding || !decision.reasonCodes.includes(expectedReason)) {
          throw new Error("incompatible_editable_finding");
        }
        if (!decision.reasonCodes.some((code) => EDITABLE_REASON_CODES.has(code))) {
          throw new Error("missing_editable_reason");
        }
      }
    }
  });
  for (const entityId of projectedByEntityId.keys()) {
    const decision = projection.decisions.find((entry) => entry.entityId === entityId);
    if (!decision?.included) throw new Error("missing_projection_decision");
  }
  return { projection, snapshot, options };
}

function reasonFor(candidate: SelectedPathCandidate): string {
  return [
    `v2-role=${candidate.role}`,
    `findings=${candidate.findingIds.join(",")}`,
    `evidence=${candidate.evidenceIds.join(",")}`,
    `review=${candidate.reviewRequired ? "required" : "not-required"}`,
  ].join("; ");
}

function selectedFile(candidate: SelectedPathCandidate): SelectedTaskFile {
  return {
    path: candidate.file.normalizedPath,
    kind: mapLegacyFileKind(candidate.file.kind),
    usage: selectedUsage(candidate.role, candidate.file),
    reason: reasonFor(candidate),
    confidence: COMPATIBILITY_CONFIDENCE[candidate.role],
  };
}

function candidateFromDecision(
  decision: ProjectionEntityDecision,
  filesById: ReadonlyMap<string, FileDescriptor>,
  options: LegacyProjectionOptions,
): SelectedPathCandidate | null {
  if (
    !decision.included ||
    !decision.role ||
    !decision.fileId ||
    !decision.path ||
    decision.findingIds.length === 0 ||
    decision.evidenceIds.length === 0 ||
    ((decision.role === "target" || decision.role === "test") && decision.reviewRequired)
  ) {
    return null;
  }
  const file = filesById.get(decision.fileId);
  if (
    !file ||
    file.normalizedPath !== decision.path ||
    !file.readable ||
    file.secretRisk === "known" ||
    pathMatchesNegativeConstraints(file.normalizedPath, options.negativeConstraints) ||
    (file.generated && (decision.role === "target" || decision.role === "test"))
  ) {
    return null;
  }
  return {
    file,
    role: decision.role,
    findingIds: sortedUnique(decision.findingIds),
    evidenceIds: sortedUnique(decision.evidenceIds),
    reviewRequired: decision.reviewRequired,
  };
}

function createSelection(input: {
  candidates: SelectedPathCandidate[];
  options: LegacyProjectionOptions;
}): TaskFileSelection {
  const selectedFiles = input.candidates.map(selectedFile);
  const assetCount = input.candidates.filter((entry) => entry.file.kind === "asset").length;
  const assetMode = assetCount === 0
    ? "none"
    : assetCount === input.candidates.length
      ? "primary"
      : "mixed";
  return {
    selectedFiles,
    rejectedModelPaths: [],
    source: "deterministic",
    usedFallback: false,
    durationMs: input.options.durationMs ?? 0,
    notes: [
      "offline CE2 compatibility projection",
      "legacy confidence fields are compatibility-derived and are not v2 epistemic confidence",
    ],
    effectiveTaskArea: input.options.effectiveTaskArea,
    assetMode,
    diagnostics: {
      selectorVersion: "context-engine-v2-ce2-05",
      safetyProfile: "offline-projection",
      generationMode: "template",
      model: null,
      requestedTaskType: input.options.requestedTaskType,
      effectiveTaskArea: input.options.effectiveTaskArea,
      usedFallback: false,
      selectionSource: "shadow-deterministic",
      roleAdjustments: ["compatibility-derived confidence; domain truth unchanged"],
    },
  };
}

function projectInternal(
  rawProjection: ContextProjectionResult,
  rawSnapshot: RepositorySnapshot,
  rawOptions: LegacyProjectionOptions,
): LegacyProjectionResult {
  const { projection, snapshot, options } = validateInputs(rawProjection, rawSnapshot, rawOptions);
  const filesById = new Map(snapshot.files.map((file) => [file.id, file]));
  const candidates = new Map<string, SelectedPathCandidate>();
  for (const decision of projection.decisions) {
    const candidate = candidateFromDecision(decision, filesById, options);
    if (candidate) mergeCandidate(candidates, candidate);
  }
  const selectedCandidates = [...candidates.values()].sort((left, right) =>
    ROLE_PRECEDENCE[right.role] - ROLE_PRECEDENCE[left.role] ||
    stableCompare(left.file.normalizedPath, right.file.normalizedPath));
  const traces: Record<string, LegacyProjectionFileTrace> = {};
  selectedCandidates.forEach((candidate) => {
    traces[candidate.file.normalizedPath] = {
      role: candidate.role,
      findingIds: candidate.findingIds,
      evidenceIds: candidate.evidenceIds,
      reviewRequired: candidate.reviewRequired,
      compatibilityDerivedConfidence: COMPATIBILITY_CONFIDENCE[candidate.role],
    };
  });
  const diagnostics: LegacyProjectionDiagnostic[] = [
    {
      code: "offline_projection" as const,
      message: "Offline CE2 compatibility projection; production selector was not invoked.",
    },
    {
      code: "compatibility_confidence_derived" as const,
      message: "Legacy confidence values are fixed role constants and do not represent domain confidence.",
    },
    {
      code: "unsupported_legacy_field" as const,
      message: "Model and selector-only diagnostics are conservatively unavailable.",
    },
    ...projection.decisions
      .filter((decision) => !decision.included)
      .flatMap((decision): LegacyProjectionDiagnostic[] => decision.reasonCodes.map((reasonCode) => ({
        code: "excluded_projection_path" as const,
        message: "Projection entity was excluded before legacy mapping.",
        ...(decision.path === undefined ? {} : { path: decision.path }),
        reasonCode,
      }))),
  ].sort((left, right) =>
    stableCompare(left.code, right.code) ||
    stableCompare(left.path ?? "", right.path ?? "") ||
    stableCompare(left.reasonCode ?? "", right.reasonCode ?? ""));
  const output: LegacyProjectionResult = {
    selection: createSelection({ candidates: selectedCandidates, options }),
    diagnostics,
    files: traces,
    excluded: projection.decisions
      .filter((decision) => !decision.included)
      .map((decision) => ({
        ...(decision.path === undefined ? {} : { path: decision.path }),
        entityId: decision.entityId,
        reasons: decision.reasonCodes,
      }))
      .sort((left, right) =>
        stableCompare(left.path ?? "", right.path ?? "") ||
        stableCompare(left.entityId, right.entityId)),
    unsupportedFields: [
      "model execution diagnostics",
      "legacy selector fallback diagnostics",
      "legacy evidence-level scoring",
    ],
  };
  return deepFreeze(output);
}

export function createLegacyTaskFileSelectionProjection(): LegacyTaskFileSelectionProjection {
  return {
    project(projectionResult, snapshot, options) {
      try {
        return projectInternal(projectionResult, snapshot, options);
      } catch (error) {
        if (error instanceof Error && error.message === "snapshot_mismatch") {
          throw new LegacyProjectionError(
            "snapshot_mismatch",
            "Legacy projection and repository snapshot do not match.",
          );
        }
        throw new LegacyProjectionError(
          "invalid_projection",
          "Legacy compatibility projection failed safe runtime validation.",
        );
      }
    },
  };
}
