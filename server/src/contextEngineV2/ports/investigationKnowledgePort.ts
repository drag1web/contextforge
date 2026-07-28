import type {
  ClaimId,
  ClaimRecord,
  EntityId,
  EvidenceRecord,
  FactId,
  FactRecord,
  InvestigationId,
  RepositoryEntity,
  RepositorySnapshot,
} from "../contracts/index.js";

export interface InvestigationKnowledgePort {
  beginInvestigation(
    investigationId: InvestigationId,
    snapshot: RepositorySnapshot,
  ): Promise<void>;
  putEntities(entities: RepositoryEntity[]): Promise<void>;
  putFacts(facts: FactRecord[]): Promise<void>;
  putClaims(claims: ClaimRecord[]): Promise<void>;
  putEvidence(evidence: EvidenceRecord[]): Promise<void>;
  getEntity(id: EntityId): Promise<RepositoryEntity | null>;
  getFact(id: FactId): Promise<FactRecord | null>;
  getClaim(id: ClaimId): Promise<ClaimRecord | null>;
}
