import type { Finding, UnresolvedQuestion } from "./evidence.js";
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
