import type {
  ClaimRecord,
  EvidenceRecord,
  FactRecord,
  Finding,
  InvestigationHypothesis,
  InvestigationOperationRecord,
  KnowledgeGap,
  RepositorySnapshot,
} from "../contracts/index.js";
import {
  cloneDomainValue,
  sortedUnique,
  stableCompare,
} from "../domain/investigationDomainSupport.js";

const BEHAVIOR_PREDICATES = new Set([
  "calls",
  "contains",
  "defines_endpoint",
  "defines_route",
  "renders",
]);
const RELATIONSHIP_PREDICATES = new Set([
  "calls",
  "contains",
  "defines_endpoint",
  "defines_route",
  "exports",
  "imports",
  "re_exports",
  "renders",
  "tests",
]);

export interface KnowledgeGapEvaluationDecision {
  knowledgeGapId: KnowledgeGap["id"];
  outcome: "resolved" | "kept_open";
  reasonCode: string;
  evidenceIds: EvidenceRecord["id"][];
}

export function evaluateKnowledgeGapResolution(input: {
  snapshot: RepositorySnapshot;
  gaps: readonly KnowledgeGap[];
  claims: readonly ClaimRecord[];
  hypotheses: readonly InvestigationHypothesis[];
  facts: readonly FactRecord[];
  evidence: readonly EvidenceRecord[];
  findings: readonly Finding[];
  operationRecords: readonly InvestigationOperationRecord[];
}): { gaps: KnowledgeGap[]; decisions: KnowledgeGapEvaluationDecision[] } {
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const claimsByHypothesisId = new Map(
    input.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis.claimId]),
  );
  const operationsById = new Map(
    input.operationRecords.map((record) => [record.operation.id, record.operation]),
  );

  const evidenceRelevantToGap = (
    evidence: EvidenceRecord,
    gap: KnowledgeGap,
  ): boolean => {
    if (
      evidence.claimId !== undefined &&
      gap.relatedHypothesisIds.some(
        (id) => claimsByHypothesisId.get(id) === evidence.claimId,
      )
    ) {
      return true;
    }
    return evidence.factIds.some((factId) => {
      const fact = factsById.get(factId);
      if (!fact) return false;
      if (
        gap.relatedEntityIds.includes(fact.subject.id) ||
        (fact.kind === "relation" && gap.relatedEntityIds.includes(fact.object.id))
      ) {
        return true;
      }
      const operationId = fact.provenance.operationId;
      const operation = operationId ? operationsById.get(operationId) : undefined;
      return operation !== undefined &&
        gap.relatedHypothesisIds.some((id) => operation.hypothesisIds.includes(id));
    });
  };

  const currentGroundedEvidence = (gap: KnowledgeGap): EvidenceRecord[] =>
    input.evidence.filter(
      (record) =>
        record.role === "supports" &&
        record.freshness.current &&
        record.strength !== "lead" &&
        evidenceRelevantToGap(record, gap) &&
        record.factIds.some((id) => factsById.get(id)?.status === "active"),
    );

  const decisions: KnowledgeGapEvaluationDecision[] = [];
  const gaps = [...input.gaps]
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((rawGap) => {
      const gap = cloneDomainValue(rawGap);
      if (gap.status !== "open") return gap;
      const groundedEvidence = currentGroundedEvidence(gap);
      const groundedFacts = groundedEvidence.flatMap((record) =>
        record.factIds.map((id) => factsById.get(id)).filter((fact): fact is FactRecord => fact !== undefined),
      );
      let resolved = false;
      let reasonCode = "insufficient_semantic_basis";
      switch (gap.category) {
        case "missing_owner": {
          const relatedClaimIds = new Set(
            gap.relatedHypothesisIds
              .map((id) => claimsByHypothesisId.get(id))
              .filter((id): id is ClaimRecord["id"] => id !== undefined),
          );
          const supportedOwner = input.claims.some(
            (claim) =>
              claim.type === "implementation_owner" &&
              claim.status === "supported" &&
              relatedClaimIds.has(claim.id),
          );
          const confirmedOwner = input.findings.some(
            (finding) =>
              finding.type === "implementation_target" &&
              finding.status === "confirmed" &&
              finding.evidenceIds.some((id) =>
                groundedEvidence.some((record) => record.id === id),
              ),
          );
          resolved = (supportedOwner || confirmedOwner) && groundedEvidence.length > 0;
          reasonCode = resolved ? "supported_owner_basis" : reasonCode;
          break;
        }
        case "missing_behavior":
          resolved = groundedFacts.some(
            (fact) => fact.status === "active" && BEHAVIOR_PREDICATES.has(fact.predicate),
          );
          reasonCode = resolved ? "current_behavior_fact" : reasonCode;
          break;
        case "missing_relationship":
          resolved = groundedFacts.some(
            (fact) =>
              fact.kind === "relation" &&
              fact.status === "active" &&
              RELATIONSHIP_PREDICATES.has(fact.predicate),
          );
          reasonCode = resolved ? "active_exact_relationship" : reasonCode;
          break;
        case "missing_test_evidence":
          resolved = groundedFacts.some(
            (fact) =>
              fact.status === "active" &&
              (fact.predicate === "tests" ||
                fact.subject.kind === "test_case" ||
                (fact.kind === "relation" && fact.object.kind === "test_case")),
          );
          reasonCode = resolved ? "current_test_fact" : reasonCode;
          break;
        case "missing_runtime_variant":
          resolved = groundedFacts.some(
            (fact) => fact.status === "active" && fact.predicate === "configuration",
          );
          reasonCode = resolved ? "current_configuration_fact" : reasonCode;
          break;
        case "snapshot_truncated":
          resolved = !input.snapshot.truncation.truncated;
          reasonCode = resolved ? "complete_snapshot" : "snapshot_still_truncated";
          break;
        case "unreadable_source":
          // KnowledgeGap currently has no source identity. Keeping the gap open is
          // safer than treating evidence from another file as a successful reread.
          reasonCode = "source_identity_unavailable";
          break;
        case "safety_restricted":
          reasonCode = "safety_restriction_not_auto_resolvable";
          break;
        case "ambiguous_user_intent":
          reasonCode = "user_intent_not_repository_resolvable";
          break;
        case "custom":
          reasonCode = "custom_gap_requires_explicit_resolution";
          break;
      }
      if (resolved) gap.status = "resolved";
      decisions.push({
        knowledgeGapId: gap.id,
        outcome: resolved ? "resolved" : "kept_open",
        reasonCode,
        evidenceIds: sortedUnique(groundedEvidence.map((record) => record.id)),
      });
      return gap;
    });
  return { gaps, decisions };
}
