import type { Finding, UnresolvedQuestion } from "./evidence.js";
import type { StopReason } from "./investigation.js";
import type {
  EntityId,
  EvidenceId,
  FindingId,
  SnapshotId,
} from "./ids.js";

export interface ProjectedEntity {
  entityId: EntityId;
  role: "target" | "supporting" | "reference" | "test";
  reason: string;
  findingIds: FindingId[];
  evidenceIds: EvidenceId[];
  reviewRequired: boolean;
}

export interface ProjectedExclusion {
  entityId: EntityId;
  reason: string;
}

export interface ProjectionEvidenceSummary {
  evidenceIds: EvidenceId[];
  limitations: string[];
}

export interface ContextProjection {
  snapshotId: SnapshotId;
  purpose: "implementation" | "review" | "clarification" | "legacy_selection";
  primaryEntities: ProjectedEntity[];
  supportingEntities: ProjectedEntity[];
  referenceEntities: ProjectedEntity[];
  excludedEntities: ProjectedExclusion[];
  findings: Finding[];
  unresolvedQuestions: UnresolvedQuestion[];
  evidenceSummary: ProjectionEvidenceSummary;
}

export type ProjectionReasonCode =
  | "ambiguous_entity_file"
  | "blocking_contradiction"
  | "blocking_gap"
  | "confirmed_implementation_target"
  | "confirmed_supporting_context"
  | "confirmed_test_target"
  | "cross_snapshot_reference"
  | "explicit_target_eligible"
  | "explicit_target_unknown"
  | "explicit_target_unresolved"
  | "evidence_entity_mismatch"
  | "generated_reference_only"
  | "generated_target_blocked"
  | "missing_evidence"
  | "negative_constraint"
  | "probable_review_only"
  | "result_not_safe_to_project"
  | "risk_requires_review"
  | "secret_file"
  | "stop_reason_blocks_projection"
  | "unknown_entity"
  | "unreadable_file"
  | "unresolved_ineligible";

export interface ProjectionDiagnostic {
  code: ProjectionReasonCode;
  message: string;
  entityId?: EntityId;
  findingId?: FindingId;
  evidenceIds: EvidenceId[];
  path?: string;
  targetKey?: string;
}

export interface ProjectionEntityDecision {
  entityId: EntityId;
  fileId?: EntityId;
  path?: string;
  role?: ProjectedEntity["role"];
  included: boolean;
  reviewRequired: boolean;
  findingIds: FindingId[];
  evidenceIds: EvidenceId[];
  reasonCodes: ProjectionReasonCode[];
}

export interface ContextProjectionResult {
  projection: ContextProjection;
  source: {
    stopReason: StopReason;
    safeToProject: boolean;
  };
  diagnostics: ProjectionDiagnostic[];
  decisions: ProjectionEntityDecision[];
}
