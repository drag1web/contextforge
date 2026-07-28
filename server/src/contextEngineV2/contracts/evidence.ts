import type { FactPredicate } from "./facts.js";
import type {
  ClaimId,
  ContradictionId,
  EntityId,
  EvidenceId,
  FactId,
  FindingId,
  HypothesisId,
  KnowledgeGapId,
  OperationId,
  SnapshotId,
} from "./ids.js";
import type { InvestigationOperationProposal } from "./operations.js";
import type { EntityKind, EntityRef, SourceSpan } from "./repository.js";
import type { LiteralValue } from "./facts.js";

export type EvidenceStrength =
  | "conclusive"
  | "substantial"
  | "corroborating"
  | "lead";

export interface EvidenceFreshness {
  snapshotId: SnapshotId;
  current: boolean;
  reason?: "snapshot_match" | "fingerprint_match" | "stale" | "unknown";
}

export interface EvidenceRecord {
  id: EvidenceId;
  snapshotId: SnapshotId;
  claimId?: ClaimId;
  role: "supports" | "contradicts" | "context_only";
  factIds: FactId[];
  sourceSpans: SourceSpan[];
  summary: string;
  strength: EvidenceStrength;
  independenceGroup: string;
  freshness: EvidenceFreshness;
  limitations: string[];
}

export type ClaimType =
  | "implementation_owner"
  | "supporting_context"
  | "behavior"
  | "data_flow"
  | "route_flow"
  | "state_flow"
  | "configuration"
  | "test_coverage"
  | "absence"
  | "risk"
  | "custom";

export type ClaimStatus =
  | "proposed"
  | "supported"
  | "rejected"
  | "contradicted"
  | "unresolved";

export interface ClaimDerivation {
  ruleId: string;
  ruleVersion: string;
  inputFactIds: FactId[];
}

export interface ClaimRecord {
  id: ClaimId;
  snapshotId: SnapshotId;
  type: ClaimType;
  statement: string;
  subject?: EntityRef;
  object?: EntityRef | LiteralValue;
  supportingEvidenceIds: EvidenceId[];
  contradictingEvidenceIds: EvidenceId[];
  status: ClaimStatus;
  derivation: ClaimDerivation;
}

export interface EvidenceRequirement {
  id: string;
  description: string;
  acceptedFactPredicates?: FactPredicate[];
  acceptedEntityKinds?: EntityKind[];
  minimumStrength: EvidenceStrength;
  minimumIndependentGroups: number;
  required: boolean;
}

export interface HypothesisTransition {
  from: "open" | "supported" | "rejected" | "unresolved";
  to: "open" | "supported" | "rejected" | "unresolved";
  reason: string;
  evidenceIds: EvidenceId[];
  operationId?: OperationId;
  occurredAt: string;
}

export interface InvestigationHypothesis {
  id: HypothesisId;
  claimId: ClaimId;
  priority: "critical" | "high" | "normal" | "low";
  status: "open" | "supported" | "rejected" | "unresolved";
  requiredEvidence: EvidenceRequirement[];
  supportingEvidenceIds: EvidenceId[];
  contradictingEvidenceIds: EvidenceId[];
  openQuestionIds: KnowledgeGapId[];
  revision: number;
  history: HypothesisTransition[];
}

export interface ContradictionResolution {
  summary: string;
  evidenceIds: EvidenceId[];
  resolvedAt: string;
}

export interface ContradictionRecord {
  id: ContradictionId;
  snapshotId: SnapshotId;
  claimId: ClaimId;
  evidenceIds: EvidenceId[];
  type:
    | "mutually_exclusive_claims"
    | "stale_vs_current"
    | "declared_vs_implemented"
    | "multiple_owners"
    | "parser_disagreement"
    | "unresolved_alias"
    | "custom";
  severity: "blocking" | "material" | "informational";
  status: "open" | "resolved" | "accepted_ambiguity";
  resolution?: ContradictionResolution;
}

export type KnowledgeGapCategory =
  | "missing_owner"
  | "missing_behavior"
  | "missing_relationship"
  | "missing_runtime_variant"
  | "missing_test_evidence"
  | "ambiguous_user_intent"
  | "snapshot_truncated"
  | "unreadable_source"
  | "safety_restricted"
  | "custom";

export interface KnowledgeGap {
  id: KnowledgeGapId;
  snapshotId: SnapshotId;
  category: KnowledgeGapCategory;
  question: string;
  blocks: Array<"finding" | "projection" | "authorization">;
  relatedEntityIds: EntityId[];
  relatedHypothesisIds: HypothesisId[];
  suggestedOperations: InvestigationOperationProposal[];
  status: "open" | "resolved" | "accepted_unresolved";
}

export interface UnresolvedQuestion {
  knowledgeGapId: KnowledgeGapId;
  question: string;
  category: KnowledgeGapCategory;
}

export interface Finding {
  id: FindingId;
  snapshotId: SnapshotId;
  type:
    | "implementation_target"
    | "supporting_context"
    | "behavior_summary"
    | "constraint"
    | "risk"
    | "test_target"
    | "clarification_requirement";
  statement: string;
  entityIds: EntityId[];
  evidenceIds: EvidenceId[];
  status: "confirmed" | "probable" | "unresolved";
  limitations: string[];
  authorizationHint: "eligible" | "review_required" | "not_eligible";
}
