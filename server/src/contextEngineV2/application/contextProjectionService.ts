import type {
  EvidenceRecord,
  ExplicitTargetConstraint,
  FactRecord,
  Finding,
  ProjectedEntity,
  RepositoryEntity,
  UnresolvedQuestion,
} from "../contracts/index.js";
import {
  assertEvidenceSnapshotConsistency,
  assertFactSnapshotConsistency,
  evaluateFindingEligibility,
  validateRepositorySnapshot,
} from "../domain/index.js";
import {
  assertContradictionEvaluationConsistency,
} from "../domain/contradictionRegistry.js";
import {
  assertEntityEvaluationConsistency,
  assertEvidenceEvaluationConsistency,
  assertFactEvaluationConsistency,
} from "../domain/evaluationInvariants.js";
import {
  assertKnowledgeGapEvaluationConsistency,
} from "../domain/knowledgeGapRegistry.js";
import {
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  cloneDomainValue,
  indexDomainRecordsById,
  sortedUnique,
  stableCompare,
  stableSerialize,
} from "../domain/investigationDomainSupport.js";
import {
  evaluateProjectionEntityCandidate,
  strongerProjectionRole,
  type ProjectionEligibilityContext,
} from "./projectionEligibilityPolicy.js";
import { ContextProjectionError } from "./projectionTypes.js";
import type {
  ContextProjectionInput,
  ContextProjectionResult,
  ContextProjectionService,
  ProjectionDiagnostic,
  ProjectionEntityDecision,
  ProjectionPurpose,
  ProjectionReasonCode,
} from "./projectionTypes.js";

const INPUT_FIELDS = [
  "result",
  "snapshot",
  "purpose",
  "explicitTargets",
  "negativeConstraints",
] as const;
const RESULT_FIELDS = [
  "investigationId",
  "snapshotId",
  "phase",
  "questions",
  "claims",
  "hypotheses",
  "entities",
  "facts",
  "evidence",
  "findings",
  "contradictions",
  "knowledgeGaps",
  "coverage",
  "budgetState",
  "operationRecords",
  "trace",
  "stop",
  "safeToProject",
] as const;
const PURPOSES = new Set<ProjectionPurpose>([
  "implementation",
  "review",
  "clarification",
  "legacy_selection",
]);
const REASON_MESSAGES: Readonly<Record<ProjectionReasonCode, string>> = {
  ambiguous_entity_file: "Entity does not resolve to one verified snapshot file.",
  blocking_contradiction: "A related blocking contradiction remains open.",
  blocking_gap: "A related knowledge gap blocks projection or authorization.",
  confirmed_implementation_target: "Confirmed implementation target with current grounded evidence.",
  confirmed_supporting_context: "Confirmed grounded supporting context.",
  confirmed_test_target: "Confirmed grounded test target.",
  cross_snapshot_reference: "Record belongs to a different repository snapshot.",
  explicit_target_eligible: "Explicit target is present as an eligible projected target.",
  explicit_target_unknown: "Explicit target does not resolve in the active snapshot.",
  explicit_target_unresolved: "Explicit target exists but is not authorized as a primary target.",
  evidence_entity_mismatch: "Evidence does not have a deterministic trace to the projected entity.",
  generated_reference_only: "Generated file is retained as review-only reference context.",
  generated_target_blocked: "Generated file cannot be projected as an editable target.",
  missing_evidence: "Current grounded evidence required for projection is missing.",
  negative_constraint: "Repository path matches an explicit negative constraint.",
  probable_review_only: "Probable finding is retained for review only.",
  result_not_safe_to_project: "Investigation result is not safe for implementation projection.",
  risk_requires_review: "Grounded risk context requires review and does not authorize editing.",
  secret_file: "File has known secret risk and is excluded.",
  stop_reason_blocks_projection: "Investigation stop reason does not authorize implementation projection.",
  unknown_entity: "Finding references an unknown repository entity.",
  unreadable_file: "File is not readable in the active snapshot.",
  unresolved_ineligible: "Finding is unresolved or otherwise ineligible for primary projection.",
};

interface MutableDecision {
  entityId: ProjectionEntityDecision["entityId"];
  fileId?: ProjectionEntityDecision["fileId"];
  path?: string;
  role?: ProjectionEntityDecision["role"];
  included: boolean;
  reviewRequired: boolean;
  findingIds: Set<ProjectionEntityDecision["findingIds"][number]>;
  evidenceIds: Set<ProjectionEntityDecision["evidenceIds"][number]>;
  reasonCodes: Set<ProjectionReasonCode>;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const entry of Object.values(value)) {
    deepFreeze(entry);
  }
  return Object.freeze(value);
}

function addDecision(
  decisions: Map<string, MutableDecision>,
  input: {
    entityId: ProjectionEntityDecision["entityId"];
    findingId: ProjectionEntityDecision["findingIds"][number];
    evidenceIds: readonly ProjectionEntityDecision["evidenceIds"][number][];
    included: boolean;
    reasonCodes: readonly ProjectionReasonCode[];
    fileId?: ProjectionEntityDecision["fileId"];
    path?: string;
    role?: ProjectionEntityDecision["role"];
    reviewRequired?: boolean;
  },
): void {
  const existing = decisions.get(input.entityId);
  if (!existing) {
    decisions.set(input.entityId, {
      entityId: input.entityId,
      ...(input.fileId === undefined ? {} : { fileId: input.fileId }),
      ...(input.path === undefined ? {} : { path: input.path }),
      ...(input.role === undefined ? {} : { role: input.role }),
      included: input.included,
      reviewRequired: input.reviewRequired ?? false,
      findingIds: new Set([input.findingId]),
      evidenceIds: new Set(input.evidenceIds),
      reasonCodes: new Set(input.reasonCodes),
    });
    return;
  }
  existing.findingIds.add(input.findingId);
  input.evidenceIds.forEach((id) => existing.evidenceIds.add(id));
  input.reasonCodes.forEach((code) => existing.reasonCodes.add(code));
  existing.reviewRequired ||= input.reviewRequired ?? false;
  if (input.included) {
    existing.included = true;
    if (input.fileId !== undefined) existing.fileId = input.fileId;
    if (input.path !== undefined) existing.path = input.path;
    if (input.role !== undefined) {
      existing.role = existing.role
        ? strongerProjectionRole(existing.role, input.role)
        : input.role;
    }
  }
}

function finalizedDecision(value: MutableDecision): ProjectionEntityDecision {
  return {
    entityId: value.entityId,
    ...(value.fileId === undefined ? {} : { fileId: value.fileId }),
    ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.role === undefined ? {} : { role: value.role }),
    included: value.included,
    reviewRequired: value.reviewRequired,
    findingIds: sortedUnique([...value.findingIds]),
    evidenceIds: sortedUnique([...value.evidenceIds]),
    reasonCodes: sortedUnique([...value.reasonCodes]),
  };
}

function decisionCompare(
  left: ProjectionEntityDecision,
  right: ProjectionEntityDecision,
): number {
  const roleOrder = { target: 0, test: 1, supporting: 2, reference: 3 };
  const leftRole = left.role === undefined ? 4 : roleOrder[left.role];
  const rightRole = right.role === undefined ? 4 : roleOrder[right.role];
  return (
    leftRole - rightRole ||
    stableCompare(left.path ?? "", right.path ?? "") ||
    stableCompare(left.entityId, right.entityId)
  );
}

function toProjectedEntity(decision: ProjectionEntityDecision): ProjectedEntity {
  return {
    entityId: decision.entityId,
    role: decision.role!,
    reason: decision.reasonCodes[0] ?? "unresolved_ineligible",
    findingIds: decision.findingIds,
    evidenceIds: decision.evidenceIds,
    reviewRequired: decision.reviewRequired,
  };
}

function diagnostic(input: {
  code: ProjectionReasonCode;
  entityId?: ProjectionDiagnostic["entityId"];
  findingId?: ProjectionDiagnostic["findingId"];
  evidenceIds?: readonly ProjectionDiagnostic["evidenceIds"][number][];
  path?: string;
  targetKey?: string;
}): ProjectionDiagnostic {
  return {
    code: input.code,
    message: REASON_MESSAGES[input.code],
    ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
    ...(input.findingId === undefined ? {} : { findingId: input.findingId }),
    evidenceIds: sortedUnique(input.evidenceIds ?? []),
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.targetKey === undefined ? {} : { targetKey: input.targetKey }),
  };
}

function diagnosticCompare(
  left: ProjectionDiagnostic,
  right: ProjectionDiagnostic,
): number {
  return (
    stableCompare(left.code, right.code) ||
    stableCompare(left.targetKey ?? "", right.targetKey ?? "") ||
    stableCompare(left.path ?? "", right.path ?? "") ||
    stableCompare(left.entityId ?? "", right.entityId ?? "") ||
    stableCompare(left.findingId ?? "", right.findingId ?? "")
  );
}

function assertConstraintShapes(input: ContextProjectionInput): void {
  if (!Array.isArray(input.explicitTargets) || !Array.isArray(input.negativeConstraints)) {
    throw new Error("constraints_not_arrays");
  }
  input.explicitTargets.forEach((target) => {
    if (target.kind === "path") {
      assertClosedRecord(target, ["kind", "path"], ["kind", "path"], "Explicit path target");
      assertSafeText(target.path, "Explicit target path");
    } else if (target.kind === "symbol") {
      assertClosedRecord(target, ["kind", "symbol"], ["kind", "symbol"], "Explicit symbol target");
      assertSafeText(target.symbol, "Explicit target symbol");
    } else {
      throw new Error("unsupported_explicit_target");
    }
  });
  input.negativeConstraints.forEach((constraint) => {
    if (constraint.kind === "path") {
      assertClosedRecord(constraint, ["kind", "pattern"], ["kind", "pattern"], "Negative path constraint");
      assertSafeText(constraint.pattern, "Negative path pattern");
    } else if (constraint.kind === "semantic") {
      assertClosedRecord(constraint, ["kind", "description"], ["kind", "description"], "Semantic negative constraint");
      assertSafeText(constraint.description, "Semantic negative constraint");
    } else {
      throw new Error("unsupported_negative_constraint");
    }
  });
}

function assertEntityOccurrenceConsistency(input: {
  entities: readonly RepositoryEntity[];
  facts: ContextProjectionInput["result"]["facts"];
}): void {
  const shapesById = new Map<string, string>();
  const register = (entity: RepositoryEntity): void => {
    const shape = stableSerialize({
      snapshotId: entity.snapshotId,
      kind: entity.kind,
      displayName: entity.displayName,
      canonicalName: entity.canonicalName,
      fileId: entity.fileId,
      attributes: entity.attributes,
    });
    const existing = shapesById.get(entity.id);
    if (existing !== undefined && existing !== shape) {
      throw new Error("conflicting_entity_identity");
    }
    shapesById.set(entity.id, shape);
  };
  input.entities.forEach(register);
  input.facts.forEach((fact) => {
    register(fact.subject);
    if (fact.kind === "relation") register(fact.object);
  });
}

function assertStopStateConsistency(input: {
  result: ContextProjectionInput["result"];
  contradictions: ProjectionEligibilityContext["contradictions"];
  knowledgeGaps: ProjectionEligibilityContext["knowledgeGaps"];
}): void {
  const { result } = input;
  const stop = result.stop;
  if (
    typeof stop.safeToProject !== "boolean" ||
    !Array.isArray(stop.blockingGapIds) ||
    !Array.isArray(stop.contradictionIds) ||
    result.safeToProject !== stop.safeToProject
  ) {
    throw new Error("incoherent_stop_state");
  }
  const sufficient = stop.reason === "sufficient_evidence";
  if (sufficient !== result.safeToProject || sufficient !== stop.safeToProject) {
    throw new Error("incoherent_stop_state");
  }
  const contradictionsById = new Map(input.contradictions.map((record) => [record.id, record]));
  const gapsById = new Map(input.knowledgeGaps.map((gap) => [gap.id, gap]));
  if (
    stop.contradictionIds.some((id) => !contradictionsById.has(id)) ||
    stop.blockingGapIds.some((id) => !gapsById.has(id))
  ) {
    throw new Error("unknown_stop_reference");
  }
  if (sufficient && (stop.contradictionIds.length > 0 || stop.blockingGapIds.length > 0)) {
    throw new Error("incoherent_sufficient_evidence");
  }
  const hasOpenBlockingContradiction = input.contradictions.some((record) =>
    record.status === "open" && record.severity === "blocking");
  const hasOpenBlockingGap = input.knowledgeGaps.some((gap) =>
    gap.status === "open" && gap.blocks.length > 0);
  if (sufficient && (hasOpenBlockingContradiction || hasOpenBlockingGap)) {
    throw new Error("blocked_sufficient_evidence");
  }
}

function validateInput(raw: ContextProjectionInput): {
  input: ContextProjectionInput;
  context: ProjectionEligibilityContext;
  findings: Finding[];
} {
  const input = cloneDomainValue(raw);
  assertClosedRecord(input, INPUT_FIELDS, INPUT_FIELDS, "Context projection input");
  assertClosedRecord(input.result, RESULT_FIELDS, RESULT_FIELDS, "Investigation runner result");
  assertPortableIdentifier(input.result.investigationId, "Investigation id");
  if (input.result.phase !== "stopped" || typeof input.result.safeToProject !== "boolean") {
    throw new Error("invalid_runner_result");
  }
  if (!PURPOSES.has(input.purpose)) throw new Error("invalid_projection_purpose");
  assertConstraintShapes(input);
  const snapshotValidation = validateRepositorySnapshot(input.snapshot);
  if (!snapshotValidation.valid) throw new Error("invalid_snapshot");
  if (input.result.snapshotId !== input.snapshot.id) throw new Error("snapshot_mismatch");
  const entitiesById = indexDomainRecordsById(input.result.entities, "Projection entity");
  const factsById = indexDomainRecordsById(input.result.facts, "Projection fact");
  const evidenceById = indexDomainRecordsById(input.result.evidence, "Projection evidence");
  const findingsById = indexDomainRecordsById(input.result.findings, "Projection finding");
  const hypotheses = [...indexDomainRecordsById(input.result.hypotheses, "Projection hypothesis").values()];
  const contradictions = [...indexDomainRecordsById(input.result.contradictions, "Projection contradiction").values()];
  const knowledgeGaps = [...indexDomainRecordsById(input.result.knowledgeGaps, "Projection knowledge gap").values()];
  const facts = [...factsById.values()];
  const evidence = [...evidenceById.values()];
  const entities = [...entitiesById.values()];
  const sourceFindings = [...findingsById.values()];
  facts.forEach((fact) => {
    assertFactEvaluationConsistency({ fact, snapshotId: input.snapshot.id });
    assertFactSnapshotConsistency(fact, input.snapshot);
  });
  const filesById = new Map(input.snapshot.files.map((file) => [file.id, file]));
  entities.forEach((entity) => {
    assertEntityEvaluationConsistency({ entity, snapshotId: input.snapshot.id });
    const requiredFileId = entity.kind === "file" ? entity.id : entity.fileId;
    if (requiredFileId !== undefined && !filesById.has(requiredFileId)) {
      throw new Error("unknown_entity_file");
    }
  });
  assertEntityOccurrenceConsistency({ entities, facts });
  evidence.forEach((record) => {
    const referencedFacts = record.factIds
      .map((factId) => factsById.get(factId))
      .filter((fact): fact is NonNullable<typeof fact> => fact !== undefined);
    assertEvidenceEvaluationConsistency({
      evidence: record,
      snapshotId: input.snapshot.id,
      facts: referencedFacts,
    });
    assertEvidenceSnapshotConsistency(record, facts, input.snapshot);
  });
  contradictions.forEach((record) =>
    assertContradictionEvaluationConsistency({
      record,
      snapshotId: input.snapshot.id,
    }));
  knowledgeGaps.forEach((gap) =>
    assertKnowledgeGapEvaluationConsistency({
      gap,
      snapshotId: input.snapshot.id,
    }));
  assertStopStateConsistency({ result: input.result, contradictions, knowledgeGaps });
  const authorizationRank = { not_eligible: 0, review_required: 1, eligible: 2 } as const;
  const findings = sourceFindings.map((finding) => {
    const evaluated = evaluateFindingEligibility({
      finding,
      snapshotId: input.snapshot.id,
      evidence,
      facts,
      entities,
      contradictions: [],
      knowledgeGaps: [],
    });
    const authorizationHint = authorizationRank[finding.authorizationHint] <=
      authorizationRank[evaluated.finding.authorizationHint]
      ? finding.authorizationHint
      : evaluated.finding.authorizationHint;
    return { ...evaluated.finding, authorizationHint };
  });
  return {
    input,
    findings,
    context: {
      input,
      entitiesById,
      evidenceById,
      factsById,
      hypotheses,
      contradictions,
      knowledgeGaps,
      findings,
    },
  };
}

function explicitTargetKey(target: ExplicitTargetConstraint): string {
  return target.kind === "path"
    ? `path:${target.path.replaceAll("\\", "/").toLowerCase()}`
    : `symbol:${target.symbol}`;
}

function addExplicitTargetDiagnostics(input: {
  targets: readonly ExplicitTargetConstraint[];
  snapshot: ContextProjectionInput["snapshot"];
  entities: ReadonlyMap<string, RepositoryEntity>;
  factsById: ReadonlyMap<string, FactRecord>;
  decisions: readonly ProjectionEntityDecision[];
  purpose: ProjectionPurpose;
  diagnostics: ProjectionDiagnostic[];
}): void {
  const decisionsByEntity = new Map(input.decisions.map((entry) => [entry.entityId, entry]));
  const decisionsByPath = new Map(
    input.decisions.filter((entry) => entry.path).map((entry) => [entry.path!.toLowerCase(), entry]),
  );
  const uniqueTargets = new Map(input.targets.map((target) => [explicitTargetKey(target), target]));
  for (const target of [...uniqueTargets.values()].sort((left, right) =>
    stableCompare(explicitTargetKey(left), explicitTargetKey(right)))) {
    const targetKey = explicitTargetKey(target);
    let path: string | undefined;
    let matchedDecision: ProjectionEntityDecision | undefined;
    if (target.kind === "path") {
      const normalized = target.path.replaceAll("\\", "/").toLowerCase();
      const file = input.snapshot.files.find((entry) => entry.normalizedPath.toLowerCase() === normalized);
      path = file?.normalizedPath;
      matchedDecision = path ? decisionsByPath.get(path.toLowerCase()) : undefined;
      if (!file) {
        input.diagnostics.push(diagnostic({ code: "explicit_target_unknown", targetKey }));
        continue;
      }
    } else {
      const matchingDefinitions = [...input.entities.values()]
        .filter((entity) =>
          entity.fileId !== undefined &&
          input.snapshot.files.some((file) => file.id === entity.fileId) &&
          [...input.factsById.values()].some((fact) =>
            fact.status === "active" &&
            fact.kind === "relation" &&
            fact.predicate === "contains" &&
            fact.object.id === entity.id &&
            fact.object.fileId === entity.fileId &&
            fact.source.kind === "source_span" &&
            fact.source.fileId === entity.fileId) &&
          (entity.displayName === target.symbol || entity.canonicalName === target.symbol))
        .sort((left, right) => stableCompare(left.id, right.id));
      if (matchingDefinitions.length === 0) {
        input.diagnostics.push(diagnostic({ code: "explicit_target_unknown", targetKey }));
        continue;
      }
      if (matchingDefinitions.length > 1) {
        input.diagnostics.push(diagnostic({ code: "explicit_target_unresolved", targetKey }));
        continue;
      }
      const definition = matchingDefinitions[0]!;
      matchedDecision = decisionsByEntity.get(definition.id);
      path = input.snapshot.files.find((file) => file.id === definition.fileId)?.normalizedPath;
    }
    const targetEligible =
      matchedDecision?.included === true &&
      (matchedDecision.role === "target" || matchedDecision.role === "test") &&
      (input.purpose === "implementation" || input.purpose === "legacy_selection");
    input.diagnostics.push(diagnostic({
      code: targetEligible ? "explicit_target_eligible" : "explicit_target_unresolved",
      ...(matchedDecision?.entityId === undefined ? {} : { entityId: matchedDecision.entityId }),
      evidenceIds: matchedDecision?.evidenceIds ?? [],
      ...(path === undefined ? {} : { path }),
      targetKey,
    }));
  }
}

function projectInternal(raw: ContextProjectionInput): ContextProjectionResult {
  const { input, context, findings } = validateInput(raw);
  const decisions = new Map<string, MutableDecision>();
  const diagnostics: ProjectionDiagnostic[] = [];

  for (const finding of findings.sort((left, right) => stableCompare(left.id, right.id))) {
    if (finding.entityIds.length === 0) {
      if (finding.type === "clarification_requirement") {
        diagnostics.push(diagnostic({
          code: "unresolved_ineligible",
          findingId: finding.id,
          evidenceIds: finding.evidenceIds,
        }));
      }
      continue;
    }
    for (const entityId of finding.entityIds) {
      const entity = context.entitiesById.get(entityId);
      if (!entity) {
        addDecision(decisions, {
          entityId,
          findingId: finding.id,
          evidenceIds: finding.evidenceIds,
          included: false,
          reasonCodes: ["unknown_entity"],
        });
        diagnostics.push(diagnostic({
          code: "unknown_entity",
          entityId,
          findingId: finding.id,
          evidenceIds: finding.evidenceIds,
        }));
        continue;
      }
      const evaluated = evaluateProjectionEntityCandidate({ finding, entity, context });
      if (!evaluated.candidate) {
        const rejectedFileId = entity.fileId ?? (entity.kind === "file" ? entity.id : undefined);
        const rejectedFile = rejectedFileId === undefined
          ? undefined
          : input.snapshot.files.find((file) => file.id === rejectedFileId);
        addDecision(decisions, {
          entityId,
          findingId: finding.id,
          evidenceIds: finding.evidenceIds,
          included: false,
          reasonCodes: evaluated.reasons,
          ...(rejectedFile === undefined ? {} : {
            fileId: rejectedFile.id,
            path: rejectedFile.normalizedPath,
          }),
        });
        evaluated.reasons.forEach((code) => diagnostics.push(diagnostic({
          code,
          entityId,
          findingId: finding.id,
          evidenceIds: finding.evidenceIds,
          ...(rejectedFile === undefined ? {} : { path: rejectedFile.normalizedPath }),
        })));
        continue;
      }
      const candidate = evaluated.candidate;
      addDecision(decisions, {
        entityId,
        findingId: finding.id,
        evidenceIds: candidate.evidence.map((record) => record.id),
        included: true,
        reasonCodes: [candidate.reasonCode],
        fileId: candidate.file.id,
        path: candidate.file.normalizedPath,
        role: candidate.role,
        reviewRequired: candidate.reviewRequired,
      });
      diagnostics.push(diagnostic({
        code: candidate.reasonCode,
        entityId,
        findingId: finding.id,
        evidenceIds: candidate.evidence.map((record) => record.id),
        path: candidate.file.normalizedPath,
      }));
    }
  }

  const finalizedDecisions = [...decisions.values()]
    .map(finalizedDecision)
    .sort(decisionCompare);
  addExplicitTargetDiagnostics({
    targets: input.explicitTargets,
    snapshot: input.snapshot,
    entities: context.entitiesById,
    factsById: context.factsById,
    decisions: finalizedDecisions,
    purpose: input.purpose,
    diagnostics,
  });
  if (!input.result.safeToProject) {
    diagnostics.push(diagnostic({ code: "result_not_safe_to_project" }));
  }

  const included = finalizedDecisions.filter(
    (entry): entry is ProjectionEntityDecision & { role: NonNullable<ProjectionEntityDecision["role"]> } =>
      entry.included && entry.role !== undefined,
  );
  const unresolvedQuestions: UnresolvedQuestion[] = context.knowledgeGaps
    .filter((gap) => gap.snapshotId === input.snapshot.id && gap.status === "open")
    .map((gap) => ({
      knowledgeGapId: gap.id,
      question: gap.question,
      category: gap.category,
    }))
    .sort((left, right) => stableCompare(left.knowledgeGapId, right.knowledgeGapId));
  const evidenceIds = sortedUnique(included.flatMap((entry) => entry.evidenceIds));
  const sortedDiagnostics = diagnostics.sort(diagnosticCompare);
  const output: ContextProjectionResult = {
    projection: {
      snapshotId: input.snapshot.id,
      purpose: input.purpose,
      primaryEntities: included.filter((entry) => entry.role === "target").map(toProjectedEntity),
      supportingEntities: included
        .filter((entry) => entry.role === "supporting" || entry.role === "test")
        .map(toProjectedEntity),
      referenceEntities: included.filter((entry) => entry.role === "reference").map(toProjectedEntity),
      excludedEntities: finalizedDecisions
        .filter((entry) => !entry.included)
        .map((entry) => ({
          entityId: entry.entityId,
          reason: entry.reasonCodes[0] ?? "unresolved_ineligible",
        })),
      findings: findings.sort((left, right) => stableCompare(left.id, right.id)),
      unresolvedQuestions,
      evidenceSummary: {
        evidenceIds,
        limitations: sortedUnique(
          sortedDiagnostics
            .filter((entry) =>
              entry.code.includes("blocking") ||
              entry.code.includes("unresolved") ||
              entry.code.includes("missing") ||
              entry.code.includes("unsafe") ||
              entry.code === "negative_constraint" ||
              entry.code === "secret_file" ||
              entry.code === "unreadable_file")
            .map((entry) => entry.code),
        ),
      },
    },
    source: {
      stopReason: input.result.stop.reason,
      safeToProject:
        input.result.safeToProject && input.result.stop.safeToProject,
    },
    diagnostics: sortedDiagnostics,
    decisions: finalizedDecisions,
  };
  return deepFreeze(output);
}

export function createContextProjectionService(): ContextProjectionService {
  return {
    project(input) {
      try {
        return projectInternal(input);
      } catch (error) {
        if (error instanceof Error && error.message === "snapshot_mismatch") {
          throw new ContextProjectionError(
            "snapshot_mismatch",
            "Projection input and repository snapshot do not match.",
          );
        }
        throw new ContextProjectionError(
          "invalid_input",
          "Context projection input failed safe runtime validation.",
        );
      }
    },
  };
}
