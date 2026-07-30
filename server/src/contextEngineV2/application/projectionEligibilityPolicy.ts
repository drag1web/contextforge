import type {
  ContradictionRecord,
  EvidenceRecord,
  FactRecord,
  Finding,
  InvestigationHypothesis,
  KnowledgeGap,
  RepositoryEntity,
  RepositorySnapshot,
} from "../contracts/index.js";
import {
  hasActiveEvidenceBasis,
} from "../domain/evaluationInvariants.js";
import {
  sortedUnique,
} from "../domain/investigationDomainSupport.js";
import { pathMatchesNegativeConstraints } from "./negativeConstraintMatcher.js";
import { evaluateProjectionEvidenceForEntity } from "./projectionEvidenceTraceability.js";
import type {
  ContextProjectionInput,
  ProjectionPurpose,
  ProjectionReasonCode,
} from "./projectionTypes.js";

const TARGET_BLOCKING_LIMITATIONS = new Set([
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

const ROLE_PRECEDENCE = {
  reference: 0,
  supporting: 1,
  test: 2,
  target: 3,
} as const;

export interface ProjectionFileResolution {
  file: RepositorySnapshot["files"][number] | null;
  ambiguous: boolean;
}

export interface ProjectionEligibilityContext {
  input: ContextProjectionInput;
  entitiesById: ReadonlyMap<RepositoryEntity["id"], RepositoryEntity>;
  evidenceById: ReadonlyMap<EvidenceRecord["id"], EvidenceRecord>;
  factsById: ReadonlyMap<FactRecord["id"], FactRecord>;
  hypotheses: readonly InvestigationHypothesis[];
  contradictions: readonly ContradictionRecord[];
  knowledgeGaps: readonly KnowledgeGap[];
  findings: readonly Finding[];
}

export interface ProjectionEntityCandidate {
  entity: RepositoryEntity;
  finding: Finding;
  evidence: EvidenceRecord[];
  file: RepositorySnapshot["files"][number];
  role: "target" | "supporting" | "reference" | "test";
  reviewRequired: boolean;
  reasonCode: ProjectionReasonCode;
}

function currentGroundedEvidence(
  finding: Finding,
  context: ProjectionEligibilityContext,
): EvidenceRecord[] {
  return finding.evidenceIds
    .map((id) => context.evidenceById.get(id))
    .filter((record): record is EvidenceRecord =>
      Boolean(
        record &&
        record.snapshotId === context.input.snapshot.id &&
        record.freshness.snapshotId === context.input.snapshot.id &&
        record.freshness.current &&
        hasActiveEvidenceBasis(record, context.factsById),
      ),
    );
}

function relatedClaimIds(
  finding: Finding,
  context: ProjectionEligibilityContext,
): Set<string> {
  return new Set(
    finding.evidenceIds
      .map((id) => context.evidenceById.get(id)?.claimId)
      .filter((id): id is NonNullable<typeof id> => id !== undefined),
  );
}

function relevantHypothesisIds(
  finding: Finding,
  context: ProjectionEligibilityContext,
): Set<string> {
  const claimIds = relatedClaimIds(finding, context);
  return new Set(
    context.hypotheses
      .filter((hypothesis) => claimIds.has(hypothesis.claimId))
      .map((hypothesis) => hypothesis.id),
  );
}

export function findingHasBlockingGap(
  finding: Finding,
  context: ProjectionEligibilityContext,
): boolean {
  const entityIds = new Set(finding.entityIds);
  const hypothesisIds = relevantHypothesisIds(finding, context);
  return context.knowledgeGaps.some((gap) => {
    if (
      gap.snapshotId !== context.input.snapshot.id ||
      gap.status !== "open" ||
      (!gap.blocks.includes("projection") &&
        !gap.blocks.includes("authorization") &&
        !gap.blocks.includes("finding"))
    ) {
      return false;
    }
    if (gap.relatedEntityIds.length === 0 && gap.relatedHypothesisIds.length === 0) {
      return true;
    }
    return (
      gap.relatedEntityIds.some((id) => entityIds.has(id)) ||
      gap.relatedHypothesisIds.some((id) => hypothesisIds.has(id))
    );
  });
}

export function findingHasBlockingContradiction(
  finding: Finding,
  context: ProjectionEligibilityContext,
): boolean {
  const claimIds = relatedClaimIds(finding, context);
  const evidenceIds = new Set(finding.evidenceIds);
  return context.contradictions.some(
    (record) =>
      record.snapshotId === context.input.snapshot.id &&
      record.status === "open" &&
      record.severity === "blocking" &&
      (claimIds.has(record.claimId) || record.evidenceIds.some((id) => evidenceIds.has(id))),
  );
}

function riskBlocksEntity(
  entityId: string,
  context: ProjectionEligibilityContext,
): boolean {
  return context.findings.some(
    (finding) =>
      finding.type === "risk" &&
      finding.status !== "unresolved" &&
      finding.entityIds.includes(entityId as RepositoryEntity["id"]),
  );
}

export function resolveEntityFile(input: {
  entity: RepositoryEntity;
  finding: Finding;
  evidence: readonly EvidenceRecord[];
  snapshot: RepositorySnapshot;
  requireFileBacked: boolean;
}): ProjectionFileResolution {
  const filesById = new Map(input.snapshot.files.map((file) => [file.id, file]));
  if (input.entity.fileId !== undefined) {
    return { file: filesById.get(input.entity.fileId) ?? null, ambiguous: false };
  }
  if (input.entity.kind === "file") {
    return { file: filesById.get(input.entity.id) ?? null, ambiguous: false };
  }
  return { file: null, ambiguous: false };
}

function targetStopAllowsProjection(
  purpose: ProjectionPurpose,
  context: ProjectionEligibilityContext,
): boolean {
  if (purpose !== "implementation" && purpose !== "legacy_selection") {
    return false;
  }
  return (
    context.input.result.safeToProject === true &&
    context.input.result.stop.safeToProject === true &&
    context.input.result.stop.reason === "sufficient_evidence"
  );
}

function fileSafetyReasons(
  file: RepositorySnapshot["files"][number],
  context: ProjectionEligibilityContext,
  role: "target" | "supporting" | "reference" | "test",
): ProjectionReasonCode[] {
  return sortedUnique([
    ...(!file.readable ? ["unreadable_file" as const] : []),
    ...(file.secretRisk === "known" ? ["secret_file" as const] : []),
    ...(pathMatchesNegativeConstraints(
      file.normalizedPath,
      context.input.negativeConstraints,
    )
      ? ["negative_constraint" as const]
      : []),
    ...(file.generated && role === "target"
      ? ["generated_target_blocked" as const]
      : []),
  ]);
}

export function evaluateProjectionEntityCandidate(input: {
  finding: Finding;
  entity: RepositoryEntity;
  context: ProjectionEligibilityContext;
}): { candidate: ProjectionEntityCandidate | null; reasons: ProjectionReasonCode[] } {
  const { finding, entity, context } = input;
  if (
    finding.snapshotId !== context.input.snapshot.id ||
    entity.snapshotId !== context.input.snapshot.id
  ) {
    return { candidate: null, reasons: ["cross_snapshot_reference"] };
  }
  const referencedEvidence = finding.evidenceIds
    .map((id) => context.evidenceById.get(id))
    .filter((record): record is EvidenceRecord => record !== undefined);
  if (
    referencedEvidence.some(
      (record) =>
        record.snapshotId !== context.input.snapshot.id ||
        record.freshness.snapshotId !== context.input.snapshot.id,
    )
  ) {
    return { candidate: null, reasons: ["cross_snapshot_reference"] };
  }
  const groundedEvidence = currentGroundedEvidence(finding, context);
  const traceability = evaluateProjectionEvidenceForEntity({
    finding,
    entity,
    evidence: groundedEvidence,
    factsById: context.factsById,
    snapshot: context.input.snapshot,
    explicitTargets: context.input.explicitTargets,
  });
  const evidence = traceability.evidence;
  if (evidence.length === 0) {
    return {
      candidate: null,
      reasons: groundedEvidence.length === 0
        ? ["missing_evidence"]
        : ["evidence_entity_mismatch"],
    };
  }

  let role: ProjectionEntityCandidate["role"] | null = null;
  let reviewRequired = false;
  let reasonCode: ProjectionReasonCode = "unresolved_ineligible";

  if (finding.type === "implementation_target") {
    const targetEligible =
      targetStopAllowsProjection(context.input.purpose, context) &&
      finding.status === "confirmed" &&
      finding.authorizationHint === "eligible" &&
      evidence.some((record) => record.role === "supports" && record.strength !== "lead") &&
      !finding.limitations.some((value) => TARGET_BLOCKING_LIMITATIONS.has(value)) &&
      !findingHasBlockingGap(finding, context) &&
      !findingHasBlockingContradiction(finding, context) &&
      !riskBlocksEntity(entity.id, context);
    if (targetEligible) {
      role = "target";
      reasonCode = "confirmed_implementation_target";
    } else if (
      context.input.purpose === "review" ||
      context.input.purpose === "clarification"
    ) {
      role = "reference";
      reviewRequired = true;
      reasonCode = finding.status === "probable"
        ? "probable_review_only"
        : "unresolved_ineligible";
    } else {
      return {
        candidate: null,
        reasons: sortedUnique([
          ...(context.input.result.safeToProject
            ? []
            : ["result_not_safe_to_project" as const]),
          ...(context.input.result.stop.reason === "sufficient_evidence"
            ? []
            : ["stop_reason_blocks_projection" as const]),
          ...(findingHasBlockingGap(finding, context)
            ? ["blocking_gap" as const]
            : []),
          ...(findingHasBlockingContradiction(finding, context)
            ? ["blocking_contradiction" as const]
            : []),
          ...(riskBlocksEntity(entity.id, context)
            ? ["risk_requires_review" as const]
            : []),
          ...(!evidence.some((record) => record.role === "supports" && record.strength !== "lead")
            ? ["missing_evidence" as const]
            : []),
          "unresolved_ineligible" as const,
        ]),
      };
    }
  } else if (
    finding.type === "supporting_context" ||
    finding.type === "behavior_summary" ||
    finding.type === "constraint"
  ) {
    if (finding.status === "confirmed" && context.input.purpose !== "clarification") {
      role = "supporting";
      reviewRequired = !context.input.result.safeToProject;
      reasonCode = "confirmed_supporting_context";
    } else if (
      (finding.status === "probable" && context.input.purpose === "review") ||
      (finding.status === "unresolved" &&
        (context.input.purpose === "review" || context.input.purpose === "clarification"))
    ) {
      role = "reference";
      reviewRequired = true;
      reasonCode = finding.status === "probable"
        ? "probable_review_only"
        : "unresolved_ineligible";
    } else if (context.input.purpose === "clarification") {
      role = "reference";
      reviewRequired = true;
      reasonCode = "unresolved_ineligible";
    }
  } else if (finding.type === "test_target") {
    const testEligible =
      targetStopAllowsProjection(context.input.purpose, context) &&
      finding.status === "confirmed" &&
      finding.authorizationHint === "eligible" &&
      evidence.some((record) => record.role === "supports" && record.strength !== "lead") &&
      !finding.limitations.some((value) => TARGET_BLOCKING_LIMITATIONS.has(value)) &&
      !findingHasBlockingGap(finding, context) &&
      !findingHasBlockingContradiction(finding, context) &&
      !riskBlocksEntity(entity.id, context);
    if (testEligible) {
      role = "test";
      reasonCode = "confirmed_test_target";
    } else if (context.input.purpose === "review" || context.input.purpose === "clarification") {
      role = "reference";
      reviewRequired = true;
      reasonCode = finding.status === "probable"
        ? "probable_review_only"
        : "unresolved_ineligible";
    } else {
      return {
        candidate: null,
        reasons: sortedUnique([
          ...(context.input.result.safeToProject ? [] : ["result_not_safe_to_project" as const]),
          ...(context.input.result.stop.reason === "sufficient_evidence"
            ? []
            : ["stop_reason_blocks_projection" as const]),
          ...(findingHasBlockingGap(finding, context) ? ["blocking_gap" as const] : []),
          ...(findingHasBlockingContradiction(finding, context)
            ? ["blocking_contradiction" as const]
            : []),
          "unresolved_ineligible" as const,
        ]),
      };
    }
  } else if (finding.type === "risk") {
    if (context.input.purpose === "review" || context.input.purpose === "clarification") {
      role = "reference";
      reviewRequired = true;
      reasonCode = "risk_requires_review";
    }
  }

  if (!role) {
    return { candidate: null, reasons: ["unresolved_ineligible"] };
  }
  const fileResolution = resolveEntityFile({
    entity,
    finding,
    evidence,
    snapshot: context.input.snapshot,
    requireFileBacked: role === "target" || role === "test",
  });
  if (fileResolution.ambiguous) {
    return { candidate: null, reasons: ["ambiguous_entity_file"] };
  }
  if (!fileResolution.file) {
    return { candidate: null, reasons: ["ambiguous_entity_file"] };
  }
  if (
    role === "test" &&
    fileResolution.file.kind !== "test" &&
    fileResolution.file.kind !== "source"
  ) {
    return { candidate: null, reasons: ["unresolved_ineligible"] };
  }
  const safetyReasons = fileSafetyReasons(fileResolution.file, context, role);
  if (safetyReasons.length > 0) {
    return { candidate: null, reasons: safetyReasons };
  }
  if (fileResolution.file.generated && role !== "target") {
    reasonCode = "generated_reference_only";
    role = "reference";
    reviewRequired = true;
  }
  return {
    candidate: {
      entity,
      finding,
      evidence,
      file: fileResolution.file,
      role,
      reviewRequired,
      reasonCode,
    },
    reasons: [],
  };
}

export function strongerProjectionRole(
  left: ProjectionEntityCandidate["role"],
  right: ProjectionEntityCandidate["role"],
): ProjectionEntityCandidate["role"] {
  return ROLE_PRECEDENCE[left] >= ROLE_PRECEDENCE[right] ? left : right;
}
