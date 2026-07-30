import type {
  ClaimRecord,
  EvidenceRecord,
  FactRecord,
  Finding,
  InvestigationOperationRecord,
  InvestigationQuestion,
  KnowledgeGap,
  SnapshotId,
} from "../contracts/index.js";
import type { FindingEligibilityEvaluation } from "../domain/index.js";
import {
  cloneDomainValue,
  sortedUnique,
  stableCompare,
} from "../domain/investigationDomainSupport.js";

const QUESTION_FINDING_TYPES: Readonly<
  Record<InvestigationQuestion["category"], ReadonlySet<Finding["type"]>>
> = {
  owner: new Set(["implementation_target"]),
  behavior: new Set(["behavior_summary"]),
  constraint: new Set(["constraint"]),
  risk: new Set(["risk"]),
  test_coverage: new Set(["test_target"]),
  route_flow: new Set(["supporting_context"]),
  data_flow: new Set(["supporting_context"]),
  state_flow: new Set(["supporting_context"]),
};

const QUESTION_CLAIM_TYPES: Readonly<
  Record<InvestigationQuestion["category"], ReadonlySet<ClaimRecord["type"]>>
> = {
  owner: new Set(["implementation_owner"]),
  behavior: new Set(["behavior"]),
  constraint: new Set(["configuration"]),
  risk: new Set(["risk"]),
  test_coverage: new Set(["test_coverage"]),
  route_flow: new Set(["route_flow"]),
  data_flow: new Set(["data_flow"]),
  state_flow: new Set(["state_flow"]),
};

const QUESTION_FACT_PREDICATES: Readonly<
  Record<InvestigationQuestion["category"], ReadonlySet<string>>
> = {
  owner: new Set(["calls", "imports", "re_exports"]),
  behavior: new Set(["calls", "defines_endpoint", "defines_route", "renders"]),
  constraint: new Set(["configuration", "configures"]),
  risk: new Set(["configuration", "configures"]),
  test_coverage: new Set(["tests"]),
  route_flow: new Set(["calls", "defines_endpoint", "defines_route", "imports", "re_exports"]),
  data_flow: new Set(["calls", "imports", "re_exports"]),
  state_flow: new Set(["calls", "imports", "re_exports"]),
};

export interface InvestigationQuestionUpdate {
  questionId: InvestigationQuestion["id"];
  previousStatus: InvestigationQuestion["status"];
  status: InvestigationQuestion["status"];
  answerFindingIds: Finding["id"][];
}

function operationServesQuestion(
  record: InvestigationOperationRecord,
  questionId: InvestigationQuestion["id"],
): boolean {
  return record.operation.questionIds.includes(questionId);
}

function gapBlocksQuestion(
  gap: KnowledgeGap,
  question: InvestigationQuestion,
  operationRecords: readonly InvestigationOperationRecord[],
): boolean {
  if (gap.status !== "open") return false;
  if (!new Set(["safety_restricted", "snapshot_truncated", "unreadable_source"]).has(gap.category)) {
    return false;
  }
  if (
    gap.suggestedOperations.some((proposal) => proposal.questionIds.includes(question.id)) ||
    gap.question === question.text
  ) {
    return true;
  }
  return operationRecords.some(
    (record) =>
      operationServesQuestion(record, question.id) &&
      gap.relatedHypothesisIds.some((id) => record.operation.hypothesisIds.includes(id)),
  );
}

export function evaluateInvestigationQuestions(input: {
  snapshotId: SnapshotId;
  questions: readonly InvestigationQuestion[];
  claims: readonly ClaimRecord[];
  facts: readonly FactRecord[];
  evidence: readonly EvidenceRecord[];
  findings: readonly Finding[];
  findingEvaluations: readonly FindingEligibilityEvaluation[];
  knowledgeGaps: readonly KnowledgeGap[];
  operationRecords: readonly InvestigationOperationRecord[];
}): { questions: InvestigationQuestion[]; updates: InvestigationQuestionUpdate[] } {
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const recordsByOperationId = new Map(
    input.operationRecords.map((record) => [record.operation.id, record]),
  );
  const recordsByEvidenceId = new Map<string, InvestigationOperationRecord>();
  for (const record of input.operationRecords) {
    record.producedEvidenceIds.forEach((id) => recordsByEvidenceId.set(id, record));
  }
  const evidenceById = new Map(input.evidence.map((record) => [record.id, record]));
  const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]));
  const findingEvaluationById = new Map(
    input.findingEvaluations.map((evaluation) => [evaluation.finding.id, evaluation]),
  );

  const evidenceServesQuestion = (
    evidence: EvidenceRecord,
    questionId: InvestigationQuestion["id"],
  ): boolean => {
    const directRecord = recordsByEvidenceId.get(evidence.id);
    if (directRecord && operationServesQuestion(directRecord, questionId)) return true;
    return evidence.factIds.some((factId) => {
      const operationId = factsById.get(factId)?.provenance.operationId;
      const operationRecord = operationId
        ? recordsByOperationId.get(operationId)
        : undefined;
      return operationRecord
        ? operationServesQuestion(operationRecord, questionId)
        : false;
    });
  };

  const evidenceIsCompatible = (
    evidence: EvidenceRecord,
    question: InvestigationQuestion,
  ): boolean => {
    if (evidence.claimId !== undefined) {
      const claim = claimsById.get(evidence.claimId);
      return claim !== undefined && QUESTION_CLAIM_TYPES[question.category].has(claim.type);
    }
    return evidence.factIds.some((factId) => {
      const fact = factsById.get(factId);
      return fact !== undefined && QUESTION_FACT_PREDICATES[question.category].has(fact.predicate);
    });
  };

  const findingIsCompatible = (
    finding: Finding,
    question: InvestigationQuestion,
  ): boolean => {
    if (!QUESTION_FINDING_TYPES[question.category].has(finding.type)) return false;
    if (question.category !== "owner") return true;
    return finding.evidenceIds.some((evidenceId) => {
      const claimId = evidenceById.get(evidenceId)?.claimId;
      const claim = claimId === undefined ? undefined : claimsById.get(claimId);
      return claim?.type === "implementation_owner" && claim.status === "supported";
    });
  };

  const questions = [...input.questions]
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((rawQuestion) => {
      const question = cloneDomainValue(rawQuestion);
      const explicitlyLinkedFindings = new Set(question.answerFindingIds);
      const relevantFindings = input.findings.filter((finding) =>
        finding.snapshotId === input.snapshotId &&
        findingIsCompatible(finding, question) &&
        (explicitlyLinkedFindings.has(finding.id) ||
          finding.evidenceIds.some((evidenceId) => {
            const evidence = evidenceById.get(evidenceId);
            return evidence ? evidenceServesQuestion(evidence, question.id) : false;
          })),
      );
      const answeredFindingIds = sortedUnique(
        relevantFindings
          .filter((finding) => {
            const evaluation = findingEvaluationById.get(finding.id);
            return finding.status === "confirmed" &&
              evaluation?.eligible === true &&
              evaluation.safeToProject;
          })
          .map((finding) => finding.id),
      );
      const relevantFindingEntityIds = new Set(
        relevantFindings.flatMap((finding) => finding.entityIds),
      );
      const relevantFindingEntityNames = new Set(
        input.facts.flatMap((fact) => {
          const entities = fact.kind === "relation"
            ? [fact.subject, fact.object]
            : [fact.subject];
          return entities
            .filter((entity) => relevantFindingEntityIds.has(entity.id))
            .map((entity) => entity.displayName);
        }),
      );
      const requiredRelationshipPredicates = new Set(
        input.facts
          .filter((fact) => {
            if (
              fact.kind !== "relation" ||
              !new Set(["imports", "re_exports"]).has(fact.predicate)
            ) {
              return false;
            }
            const importedName = fact.object.attributes?.importedName;
            if (
              typeof importedName !== "string" ||
              !relevantFindingEntityNames.has(importedName)
            ) {
              return false;
            }
            const operationId = fact.provenance.operationId;
            const record = operationId
              ? recordsByOperationId.get(operationId)
              : undefined;
            return record ? operationServesQuestion(record, question.id) : false;
          })
          .map((fact) => fact.predicate),
      );
      const followedRelationshipPredicates = new Set(
        input.operationRecords
          .filter(
            (record) =>
              record.status === "completed" &&
              record.operation.type === "follow_relationship" &&
              operationServesQuestion(record, question.id),
          )
          .flatMap((record) =>
            record.operation.type === "follow_relationship"
              ? record.operation.predicates
              : [],
          ),
      );
      const requiredRelationshipsVerified = [...requiredRelationshipPredicates].every(
        (predicate) => followedRelationshipPredicates.has(predicate),
      );
      const hasPartialFinding = relevantFindings.some(
        (finding) => finding.status === "probable" || finding.status === "confirmed",
      );
      const hasCurrentLead = input.evidence.some(
        (record) =>
          record.snapshotId === input.snapshotId &&
          record.freshness.current &&
          evidenceIsCompatible(record, question) &&
          evidenceServesQuestion(record, question.id),
      );
      const blocked = input.knowledgeGaps.some((gap) =>
        gapBlocksQuestion(gap, question, input.operationRecords),
      );
      question.answerFindingIds = requiredRelationshipsVerified
        ? answeredFindingIds
        : [];
      question.status = answeredFindingIds.length > 0 && requiredRelationshipsVerified
        ? "answered"
        : blocked
          ? "blocked"
          : hasPartialFinding || hasCurrentLead
            ? "partially_answered"
            : "open";
      return question;
    });
  const previousById = new Map(input.questions.map((question) => [question.id, question]));
  const updates = questions
    .filter((question) => {
      const previous = previousById.get(question.id);
      return previous &&
        (previous.status !== question.status ||
          JSON.stringify(previous.answerFindingIds) !== JSON.stringify(question.answerFindingIds));
    })
    .map((question) => ({
      questionId: question.id,
      previousStatus: previousById.get(question.id)!.status,
      status: question.status,
      answerFindingIds: cloneDomainValue(question.answerFindingIds),
    }));
  return { questions, updates };
}
