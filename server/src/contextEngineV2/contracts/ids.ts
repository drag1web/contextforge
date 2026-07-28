declare const contextEngineIdBrand: unique symbol;

export type OpaqueId<Kind extends string> = string & {
  readonly [contextEngineIdBrand]: Kind;
};

export type SnapshotId = OpaqueId<"SnapshotId">;
export type EntityId = OpaqueId<"EntityId">;
export type FactId = OpaqueId<"FactId">;
export type EvidenceId = OpaqueId<"EvidenceId">;
export type ClaimId = OpaqueId<"ClaimId">;
export type HypothesisId = OpaqueId<"HypothesisId">;
export type ContradictionId = OpaqueId<"ContradictionId">;
export type KnowledgeGapId = OpaqueId<"KnowledgeGapId">;
export type FindingId = OpaqueId<"FindingId">;
export type InvestigationId = OpaqueId<"InvestigationId">;
export type InvestigationRequestId = OpaqueId<"InvestigationRequestId">;
export type OperationId = OpaqueId<"OperationId">;
export type QuestionId = OpaqueId<"QuestionId">;
