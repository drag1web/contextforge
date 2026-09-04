import type {
  ClaimRecord,
  ContradictionRecord,
  EvidenceRecord,
  FactRecord,
  FileDescriptor,
  Finding,
  InvestigationBudgetState,
  InvestigationCoverage,
  InvestigationHypothesis,
  InvestigationOperation,
  InvestigationOperationRecord,
  InvestigationQuestion,
  InvestigationStop,
  KnowledgeGap,
  OperationCost,
  RepositoryEntity,
  SnapshotId,
  SourceSpan,
} from "../contracts/index.js";
import {
  InvariantViolationError,
  applyOperationCost,
  assertFactSnapshotConsistency,
  calculateInvestigationCoverage,
  canFitOperationCost,
  createContradictionRegistry,
  createEvidenceLedger,
  createHypothesisLedger,
  createInvestigationBudgetState,
  createKnowledgeGapRegistry,
  createStopPolicy,
  detectDeterministicContradictions,
  evaluateClaim,
  evaluateFindingEligibility,
  validateRepositorySnapshot,
} from "../domain/index.js";
import {
  assertEntityEvaluationConsistency,
  assertEvidenceEvaluationConsistency,
  assertFactEvaluationConsistency,
  assertSourceSpanEvaluationConsistency,
} from "../domain/evaluationInvariants.js";
import {
  InvestigationDomainError,
  assertCanonicalUtcTimestamp,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeInteger,
  assertSafeText,
  cloneDomainValue,
  indexDomainRecordsById,
  safeRecordId,
  sortedUnique,
  stableCompare,
  stableSerialize,
} from "../domain/investigationDomainSupport.js";
import {
  createValidatedDomainContext,
  type ValidatedDomainContext,
} from "../domain/validatedDomainContext.js";
import { assertRepositoryEntitySnapshotConsistency } from "../domain/knowledgeGraphInvariant.js";
import type {
  KnowledgeEdge,
  RepositoryReadResult,
  RepositoryReadSuccess,
  SearchResult,
} from "../ports/index.js";
import { createDeterministicInvestigationPlanner } from "./deterministicInvestigationPlanner.js";
import { deriveGroundedOperationCandidates } from "./deterministicInvestigationPlanner.js";
import { createDeterministicInvestigationInterpreter } from "./deterministicInvestigationInterpreter.js";
import { createDeterministicOperationQueue } from "./deterministicOperationQueue.js";
import { evaluateInvestigationQuestions } from "./deterministicQuestionEvaluator.js";
import { assertExtractionResultBoundToInput } from "./extractionResultBoundary.js";
import {
  deriveImplementationOwnerProofs,
  evaluateFactClaimEligibilityBatch,
  isFileBackedOwnerDefinitionFact,
} from "./factClaimEligibility.js";
import type {
  DeterministicInvestigationPlanner,
  InvestigationRunner,
  InvestigationRunnerDependencies,
  InvestigationRunnerInput,
  InvestigationRunnerResult,
  InvestigationRunnerTraceEvent,
} from "./investigationRunnerTypes.js";
import { InvestigationRunnerError } from "./investigationRunnerTypes.js";
import {
  createDeterministicOperation,
  deterministicApplicationId,
  mergeCompatibleOperations,
  validateOperation,
} from "./operationIdentity.js";
import {
  ZERO_OPERATION_COST,
  withCanonicalOperationCost,
} from "./operationCost.js";
import { pathMatchesNegativeConstraints } from "./negativeConstraintMatcher.js";
import {
  createExactDocumentIdentity,
  isExactDocumentIdentityFact,
} from "./documentIdentity.js";
import { isOperationRetryEligible } from "./operationRetryPolicy.js";
import { evaluateKnowledgeGapResolution } from "./truthfulGapEvaluator.js";

const INPUT_FIELDS = [
  "investigationId",
  "snapshot",
  "purpose",
  "request",
  "questions",
  "claims",
  "hypotheses",
  "entities",
  "facts",
  "evidence",
  "findings",
  "contradictions",
  "knowledgeGaps",
  "operationCandidates",
  "budget",
  "plannerPolicy",
  "deadlineMonotonicMs",
] as const;
const READ_SUCCESS_FIELDS = [
  "status",
  "snapshotId",
  "fileId",
  "path",
  "content",
  "contentFingerprint",
  "bytesRead",
  "startLine",
  "endLine",
] as const;
const READ_FAILURE_FIELDS = [
  "status",
  "snapshotId",
  "fileId",
  "path",
  "reason",
  "message",
  "retryable",
] as const;
const SEARCH_RESULT_FIELDS = ["kind", "snapshotId", "path", "entityId", "source"] as const;
const ZERO_COST: OperationCost = ZERO_OPERATION_COST;
const PURPOSES = new Set([
  "implementation_context",
  "review_context",
  "clarification",
  "shadow_comparison",
]);

interface ReadCacheEntry {
  result: RepositoryReadSuccess;
}

class RepositoryChangedBoundaryError extends Error {}

class InvalidOperationResultBoundaryError extends Error {
  constructor(readonly accountedBytes: number) {
    super("Repository read output failed safe integrity validation.");
  }
}

interface MutableRunnerState {
  questions: InvestigationQuestion[];
  claims: ClaimRecord[];
  hypotheses: InvestigationHypothesis[];
  entities: readonly RepositoryEntity[];
  facts: readonly FactRecord[];
  evidence: readonly EvidenceRecord[];
  validationContext: ValidatedDomainContext;
  findings: Finding[];
  findingEvaluations: ReturnType<typeof evaluateFindingEligibility>[];
  contradictions: ContradictionRecord[];
  knowledgeGaps: KnowledgeGap[];
  operationCandidates: InvestigationOperation[];
  operationRecords: InvestigationOperationRecord[];
  trace: InvestigationRunnerTraceEvent[];
  budgetState: InvestigationBudgetState;
  coverage: InvestigationCoverage;
  filesConsidered: string[];
  filesRead: string[];
  filesParsed: string[];
  relationshipHops: number;
  allRequiredEvidenceSatisfied: boolean;
  repositoryChanged: boolean;
  safetyBlocked: boolean;
  searchExhausted: boolean;
}

interface OperationOutcome {
  status: "completed" | "failed" | "blocked";
  entities: RepositoryEntity[];
  facts: FactRecord[];
  evidence: EvidenceRecord[];
  gaps: KnowledgeGap[];
  candidates: InvestigationOperation[];
  consideredPaths: string[];
  readPaths: string[];
  parsedPaths: string[];
  relationshipHops: number;
  actualCost: OperationCost;
  repositoryChanged: boolean;
  safetyBlocked: boolean;
  error?: InvestigationOperationRecord["error"];
}

function safeOperationError(
  code: string,
  message: string,
  retryable = false,
): NonNullable<InvestigationOperationRecord["error"]> {
  return { code, message, retryable };
}

function emptyOutcome(operation: InvestigationOperation): OperationOutcome {
  return {
    status: "completed",
    entities: [],
    facts: [],
    evidence: [],
    gaps: [],
    candidates: [],
    consideredPaths: [],
    readPaths: [],
    parsedPaths: [],
    relationshipHops: 0,
    actualCost: cloneDomainValue(operation.estimatedCost),
    repositoryChanged: false,
    safetyBlocked: false,
  };
}

function invalidInput(message: string, recordId?: unknown): never {
  throw new InvestigationRunnerError(
    "invalid_input",
    message,
    safeRecordId(recordId),
  );
}

function validateReadResult(
  rawResult: RepositoryReadResult,
  snapshotId: SnapshotId,
  file: FileDescriptor,
  operation: Extract<InvestigationOperation, { type: "read_file" | "read_range" }>,
  maxBytes: number,
): RepositoryReadResult {
  let result: RepositoryReadResult;
  try {
    result = cloneDomainValue(rawResult);
  } catch {
    throw new InvalidOperationResultBoundaryError(maxBytes);
  }
  if (result.status === "success") {
    try {
      assertClosedRecord(result, READ_SUCCESS_FIELDS, READ_SUCCESS_FIELDS, "Repository read success");
    } catch {
      throw new InvalidOperationResultBoundaryError(maxBytes);
    }
    if (
      result.snapshotId !== snapshotId ||
      result.fileId !== file.id ||
      result.path !== file.normalizedPath
    ) {
      throw new RepositoryChangedBoundaryError();
    }
    if (typeof result.content !== "string") {
      throw new InvalidOperationResultBoundaryError(maxBytes);
    }
    const actualUtf8Bytes = new TextEncoder().encode(result.content).byteLength;
    try {
      assertSafeText(result.contentFingerprint, "Repository read fingerprint");
      assertSafeInteger(result.bytesRead, "Repository bytes read");
      assertSafeInteger(result.startLine, "Repository read start line", { positive: true });
      assertSafeInteger(result.endLine, "Repository read end line", { positive: true });
    } catch {
      throw new InvalidOperationResultBoundaryError(
        Math.min(actualUtf8Bytes, maxBytes),
      );
    }
    const actualLines = result.content.split(/\r\n|\n|\r/u).length;
    const rangeValid = operation.type === "read_file"
      ? result.startLine === 1 && result.endLine === actualLines
      : result.startLine === operation.startLine &&
        result.endLine === operation.endLine &&
        actualLines === operation.endLine - operation.startLine + 1;
    if (
      result.bytesRead !== actualUtf8Bytes ||
      actualUtf8Bytes > maxBytes ||
      actualUtf8Bytes > file.sizeBytes ||
      result.endLine < result.startLine ||
      !rangeValid
    ) {
      throw new InvalidOperationResultBoundaryError(
        Math.min(actualUtf8Bytes, maxBytes),
      );
    }
  } else if (result.status === "failure") {
    try {
      assertClosedRecord(
        result,
        READ_FAILURE_FIELDS,
        READ_FAILURE_FIELDS.filter((field) => field !== "retryable"),
        "Repository read failure",
      );
    } catch {
      throw new InvalidOperationResultBoundaryError(maxBytes);
    }
    if (
      result.snapshotId !== snapshotId ||
      result.fileId !== file.id ||
      result.path !== file.normalizedPath
    ) {
      throw new RepositoryChangedBoundaryError();
    }
    if (
      !new Set([
        "not_found",
        "unreadable",
        "binary",
        "restricted",
        "fingerprint_mismatch",
        "range_invalid",
        "byte_limit",
      ]).has(result.reason)
    ) {
      throw new InvalidOperationResultBoundaryError(maxBytes);
    }
    if (result.retryable !== undefined && typeof result.retryable !== "boolean") {
      throw new InvalidOperationResultBoundaryError(maxBytes);
    }
  } else {
    throw new InvalidOperationResultBoundaryError(maxBytes);
  }
  return result;
}

function verifyReadSuccess(
  result: RepositoryReadSuccess,
  file: FileDescriptor,
  maxBytes: number,
): boolean {
  return result.contentFingerprint === file.contentFingerprint && result.bytesRead <= maxBytes;
}

function fileForPath(
  snapshotFiles: readonly FileDescriptor[],
  path: string,
): FileDescriptor | undefined {
  return snapshotFiles.find((file) => file.normalizedPath === path);
}

function operationGap(
  snapshotId: SnapshotId,
  operation: InvestigationOperation,
  category: KnowledgeGap["category"],
  question: string,
  blocks: KnowledgeGap["blocks"],
): KnowledgeGap {
  const id = deterministicApplicationId("gap", {
    snapshotId,
    operationId: operation.id,
    category,
  }) as KnowledgeGap["id"];
  return {
    id,
    snapshotId,
    category,
    question,
    blocks: sortedUnique(blocks),
    relatedEntityIds: [],
    relatedHypothesisIds: sortedUnique(operation.hypothesisIds),
    suggestedOperations: [],
    status: "open",
  };
}

function evidenceStrengthForFact(
  fact: FactRecord,
): EvidenceRecord["strength"] {
  if (fact.strength === "exact" || fact.strength === "strong") {
    return "substantial";
  }
  if (fact.strength === "supporting") return "corroborating";
  return "lead";
}

function evidenceForFact(
  fact: FactRecord,
  operation: InvestigationOperation,
  claimId: ClaimRecord["id"] | undefined,
): EvidenceRecord {
  const sourceSpans = fact.source.kind === "source_span" ? [fact.source] : [];
  const role: EvidenceRecord["role"] = claimId ? "supports" : "context_only";
  return {
    id: deterministicApplicationId("evidence", {
      operationId: operation.id,
      factId: fact.id,
      claimId: claimId ?? null,
      role,
    }) as EvidenceRecord["id"],
    snapshotId: fact.snapshotId,
    ...(claimId === undefined ? {} : { claimId }),
    role,
    factIds: [fact.id],
    sourceSpans,
    summary: claimId
      ? "A deterministic extractor produced current fact-backed support."
      : "A deterministic extractor produced current repository context.",
    strength: evidenceStrengthForFact(fact),
    independenceGroup: deterministicApplicationId("independence", {
      source: fact.source,
      extractorId: fact.provenance.extractorId,
    }),
    freshness: {
      snapshotId: fact.snapshotId,
      current: true,
      reason: fact.source.kind === "source_span" ? "fingerprint_match" : "snapshot_match",
    },
    limitations: [],
  };
}

function routeFactEvidence(input: {
  snapshot: InvestigationRunnerInput["snapshot"];
  request: InvestigationRunnerInput["request"];
  operation: InvestigationOperation;
  operationRecords: readonly InvestigationOperationRecord[];
  claims: readonly ClaimRecord[];
  hypotheses: readonly InvestigationHypothesis[];
  allFacts: readonly FactRecord[];
  producedFacts: readonly FactRecord[];
  checkpoint: () => void;
}): EvidenceRecord[] {
  const factsById = new Map(input.allFacts.map((fact) => [fact.id, fact]));
  const evidenceByKey = new Map<string, EvidenceRecord>();
  const supportedProducedFactIds = new Set<FactRecord["id"]>();
  for (const hypothesis of input.hypotheses.filter((candidate) =>
    input.operation.hypothesisIds.includes(candidate.id),
  )) {
    input.checkpoint();
    const claim = input.claims.find((candidate) => candidate.id === hypothesis.claimId);
    if (!claim) continue;
    const decisions = evaluateFactClaimEligibilityBatch(
      {
        factsToEvaluate: input.allFacts,
        claim,
        hypothesis,
        operation: input.operation,
        operationRecords: input.operationRecords,
        facts: input.allFacts,
        snapshot: input.snapshot,
        request: input.request,
      },
      input.checkpoint,
    );
    for (const { decision } of decisions) {
      input.checkpoint();
      if (!decision.eligible) continue;
      for (const factId of decision.supportingFactIds) {
        input.checkpoint();
        const supportingFact = factsById.get(factId);
        if (!supportingFact || supportingFact.status !== "active") continue;
        const evidence = evidenceForFact(supportingFact, input.operation, claim.id);
        evidenceByKey.set(`${evidence.claimId}\0${supportingFact.id}`, evidence);
        if (input.producedFacts.some((candidate) => candidate.id === supportingFact.id)) {
          supportedProducedFactIds.add(supportingFact.id);
        }
      }
    }
  }
  for (const fact of input.producedFacts) {
    input.checkpoint();
    if (supportedProducedFactIds.has(fact.id)) continue;
    const evidence = evidenceForFact(fact, input.operation, undefined);
    evidenceByKey.set(`context\0${fact.id}`, evidence);
  }
  return [...evidenceByKey.values()].sort((left, right) => stableCompare(left.id, right.id));
}

function sourceOnlyEvidence(
  snapshotId: SnapshotId,
  operation: InvestigationOperation,
  source: SourceSpan,
): EvidenceRecord {
  return {
    id: deterministicApplicationId("evidence", {
      operationId: operation.id,
      source,
      role: "context_only",
    }) as EvidenceRecord["id"],
    snapshotId,
    role: "context_only",
    factIds: [],
    sourceSpans: [source],
    summary: "A bounded repository operation produced a current contextual lead.",
    strength: "lead",
    independenceGroup: deterministicApplicationId("independence", source),
    freshness: {
      snapshotId,
      current: true,
      reason: "fingerprint_match",
    },
    limitations: [],
  };
}

function endColumn(content: string): number {
  const finalLine = content.split(/\r?\n/u).at(-1) ?? "";
  return finalLine.length + 1;
}

function sourceFromRead(
  snapshotId: SnapshotId,
  result: RepositoryReadSuccess,
): SourceSpan {
  return {
    kind: "source_span",
    snapshotId,
    fileId: result.fileId,
    path: result.path,
    startLine: result.startLine,
    startColumn: 1,
    endLine: result.endLine,
    endColumn: endColumn(result.content),
    contentFingerprint: result.contentFingerprint,
  };
}

function mergeRecords<T extends { id: string }>(
  existing: readonly T[],
  additions: readonly T[],
  label: string,
): T[] {
  return [...indexDomainRecordsById([...existing, ...additions], label).values()];
}

function deriveEntities(facts: readonly FactRecord[]): RepositoryEntity[] {
  return facts.flatMap((fact) =>
    fact.kind === "relation" ? [fact.subject, fact.object] : [fact.subject],
  );
}

function canonicalCost(
  operation: InvestigationOperation,
  changes: Partial<OperationCost>,
): OperationCost {
  return {
    ...cloneDomainValue(operation.estimatedCost),
    ...changes,
  };
}

function actualCostFitsReservation(
  actual: OperationCost,
  reserved: OperationCost,
): boolean {
  return (Object.keys(reserved) as Array<keyof OperationCost>).every(
    (field) => actual[field] <= reserved[field],
  );
}

function validateSearchResults(
  rawResults: readonly SearchResult[],
  snapshotId: SnapshotId,
  files: readonly FileDescriptor[],
): SearchResult[] {
  const results = cloneDomainValue(rawResults);
  if (!Array.isArray(results)) invalidInput("Repository search result must be a dense array.");
  for (const result of results) {
    assertClosedRecord(
      result,
      SEARCH_RESULT_FIELDS,
      ["kind", "snapshotId", "path"],
      "Repository search result",
    );
    const typedResult = result as unknown as SearchResult;
    if (typedResult.kind !== "lead" || typedResult.snapshotId !== snapshotId) {
      throw new RepositoryChangedBoundaryError();
    }
    assertSafeText(typedResult.path, "Repository search result path");
    const file = fileForPath(files, typedResult.path);
    if (!file || (typedResult.entityId !== undefined && typedResult.entityId !== file.id)) {
      throw new RepositoryChangedBoundaryError();
    }
    if (typedResult.source !== undefined) {
      assertSourceSpanEvaluationConsistency({ span: typedResult.source, snapshotId });
      if (
        typedResult.source.fileId !== file.id ||
        typedResult.source.path !== file.normalizedPath ||
        typedResult.source.contentFingerprint !== file.contentFingerprint
      ) {
        throw new RepositoryChangedBoundaryError();
      }
    }
  }
  return results.sort((left, right) =>
    stableCompare(
      `${left.path}\0${left.entityId ?? ""}\0${stableSerialize(left.source ?? null)}`,
      `${right.path}\0${right.entityId ?? ""}\0${stableSerialize(right.source ?? null)}`,
    ),
  );
}

function calculateCoverage(
  input: InvestigationRunnerInput,
  state: Pick<
    MutableRunnerState,
    | "questions"
    | "hypotheses"
    | "evidence"
    | "filesConsidered"
    | "filesRead"
    | "filesParsed"
    | "relationshipHops"
    | "knowledgeGaps"
    | "validationContext"
  >,
): InvestigationCoverage {
  return calculateInvestigationCoverage({
    snapshotId: input.snapshot.id,
    questions: state.questions,
    hypotheses: state.hypotheses,
    evidence: state.evidence,
    filesConsidered: sortedUnique(state.filesConsidered),
    filesRead: sortedUnique(state.filesRead),
    filesParsed: sortedUnique(state.filesParsed),
    relationshipHops: state.relationshipHops,
    snapshotTruncated: input.snapshot.truncation.truncated,
    blockedScopes: sortedUnique(
      state.knowledgeGaps
        .filter((gap) => gap.status === "open" && gap.blocks.length > 0)
        .map((gap) => gap.category),
    ),
  }, state.validationContext);
}

function enrichClaimsWithEvidence(
  claims: readonly ClaimRecord[],
  evidence: readonly EvidenceRecord[],
  checkpoint: () => void,
): ClaimRecord[] {
  return claims.map((rawClaim) => {
    checkpoint();
    const claim = cloneDomainValue(rawClaim);
    const claimEvidence = evidence.filter((record) => {
      checkpoint();
      return record.claimId === claim.id;
    });
    claim.supportingEvidenceIds = sortedUnique([
      ...claim.supportingEvidenceIds,
      ...claimEvidence.filter((record) => record.role === "supports").map((record) => record.id),
    ]);
    claim.contradictingEvidenceIds = sortedUnique([
      ...claim.contradictingEvidenceIds,
      ...claimEvidence.filter((record) => record.role === "contradicts").map((record) => record.id),
    ]);
    claim.derivation.inputFactIds = sortedUnique([
      ...claim.derivation.inputFactIds,
      ...claimEvidence.flatMap((record) => record.factIds),
    ]);
    return claim;
  });
}

function deriveImplementationFindings(input: {
  snapshot: InvestigationRunnerInput["snapshot"];
  request: InvestigationRunnerInput["request"];
  claims: readonly ClaimRecord[];
  hypotheses: readonly InvestigationHypothesis[];
  facts: readonly FactRecord[];
  evidence: readonly EvidenceRecord[];
  operation?: InvestigationOperation;
  operationRecords: readonly InvestigationOperationRecord[];
  checkpoint: () => void;
}): Finding[] {
  const findings: Finding[] = [];
  if (!input.operation) return findings;
  for (const claim of input.claims.filter(
    (candidate) => {
      input.checkpoint();
      return candidate.type === "implementation_owner" && candidate.status === "supported";
    },
  )) {
    input.checkpoint();
    const hypothesis = input.hypotheses.find(
      (candidate) => candidate.claimId === claim.id,
    );
    if (!hypothesis) continue;
    const proofs = deriveImplementationOwnerProofs({
      claim,
      hypothesis,
      operation: input.operation,
      operationRecords: input.operationRecords,
      facts: input.facts,
      snapshot: input.snapshot,
      request: input.request,
    }, input.checkpoint);
    for (const proof of proofs) {
      input.checkpoint();
      const documentIdentityFact = proof.basis === "document_identity"
        ? input.facts.find((fact) => proof.factIds.includes(fact.id) &&
          input.request !== undefined && isExactDocumentIdentityFact({
            fact,
            snapshot: input.snapshot,
            context: {
              normalizedTask: input.request.task.normalizedTask,
              explicitTargets: input.request.explicitTargets,
              negativeConstraints: input.request.negativeConstraints,
            },
          }) && fact.subject.id === proof.candidate.id)
        : undefined;
      const definitionFact = proof.basis === "document_identity"
        ? undefined
        : input.facts.find(
          (fact) =>
            proof.factIds.includes(fact.id) &&
            isFileBackedOwnerDefinitionFact(fact, input.snapshot) &&
            fact.object.id === proof.candidate.id,
        );
      const definitionSource = documentIdentityFact?.source ?? definitionFact?.source;
      if (
        (proof.basis === "document_identity" ? documentIdentityFact === undefined : definitionFact === undefined) ||
        proof.candidate.fileId === undefined ||
        definitionSource?.kind !== "source_span" ||
        !input.snapshot.files.some(
          (file) =>
            file.id === proof.candidate.fileId &&
            file.id === definitionSource.fileId &&
            file.normalizedPath === definitionSource.path,
        )
      ) {
        continue;
      }
      const evidenceIds = sortedUnique(
        input.evidence
          .filter(
            (record) =>
              record.claimId === claim.id &&
              record.role === "supports" &&
              record.freshness.current &&
              proof.factIds.some((factId) => record.factIds.includes(factId)),
          )
          .map((record) => record.id),
      );
      if (evidenceIds.length === 0) continue;
      findings.push({
        id: deterministicApplicationId("finding", {
          snapshotId: input.snapshot.id,
          claimId: claim.id,
          entityId: proof.candidate.id,
        }) as Finding["id"],
        snapshotId: input.snapshot.id,
        type: "implementation_target",
        statement: proof.basis === "document_identity"
          ? "A snapshot-verified explicit documentation path identifies the document that owns the requested edit."
          : "A deterministic grounded owner proof identifies this repository entity.",
        entityIds: [proof.candidate.id],
        evidenceIds,
        status: proofs.length === 1 ? "confirmed" : "probable",
        limitations: proofs.length === 1 ? [] : ["distinguishing_owner_basis_missing"],
        authorizationHint: "not_eligible",
      });
    }
  }
  return findings;
}

function rebuildDomainState(input: {
  snapshotId: SnapshotId;
  claims: readonly ClaimRecord[];
  hypotheses: readonly InvestigationHypothesis[];
  facts: readonly FactRecord[];
  evidence: readonly EvidenceRecord[];
  contradictions: readonly ContradictionRecord[];
  knowledgeGaps: readonly KnowledgeGap[];
  entities: readonly RepositoryEntity[];
  findings: readonly Finding[];
  occurredAt: string;
  operationId?: InvestigationOperation["id"];
  operation?: InvestigationOperation;
  operationRecords: readonly InvestigationOperationRecord[];
  snapshot: InvestigationRunnerInput["snapshot"];
  request: InvestigationRunnerInput["request"];
  checkpoint: () => void;
  validationContext: ValidatedDomainContext;
}): {
  claims: ClaimRecord[];
  hypotheses: InvestigationHypothesis[];
  contradictions: ContradictionRecord[];
  findings: Finding[];
  findingEvaluations: ReturnType<typeof evaluateFindingEligibility>[];
  allRequiredEvidenceSatisfied: boolean;
} {
  input.checkpoint();
  let claims = enrichClaimsWithEvidence(input.claims, input.evidence, input.checkpoint);
  const detections: ReturnType<typeof detectDeterministicContradictions> = [];
  for (const claim of claims) {
    input.checkpoint();
    detections.push(...detectDeterministicContradictions({
      claim,
      evidence: input.evidence,
      facts: input.facts,
      claimRequiresSingleValue:
        claim.type === "implementation_owner" || claim.type === "configuration",
      acceptedFactPredicates: sortedUnique(
        input.hypotheses
          .filter((hypothesis) => hypothesis.claimId === claim.id)
          .flatMap((hypothesis) =>
            hypothesis.requiredEvidence.flatMap(
              (requirement) => requirement.acceptedFactPredicates ?? [],
            ),
          ),
      ),
    }, input.checkpoint, input.validationContext));
  }
  input.checkpoint();
  const contradictionRegistry = createContradictionRegistry({
    snapshotId: input.snapshotId,
    claims,
    evidence: input.evidence,
  }, input.checkpoint, input.validationContext);
  input.contradictions.forEach((record) => {
    input.checkpoint();
    contradictionRegistry.add(record);
  });
  detections.forEach((detection) => {
    input.checkpoint();
    contradictionRegistry.add({
      id: deterministicApplicationId("contradiction", {
        snapshotId: input.snapshotId,
        ...detection,
      }) as ContradictionRecord["id"],
      snapshotId: input.snapshotId,
      claimId: detection.claimId,
      evidenceIds: detection.evidenceIds,
      type: detection.type,
      severity: detection.severity,
      status: "open",
    });
  });
  input.checkpoint();
  const contradictions = contradictionRegistry.snapshot();
  const ledger = createHypothesisLedger({
    snapshotId: input.snapshotId,
    claims,
    evidence: input.evidence,
    knowledgeGaps: input.knowledgeGaps,
  }, input.validationContext);
  input.hypotheses.forEach((hypothesis) => ledger.add(hypothesis));
  let allRequiredEvidenceSatisfied = true;
  for (const hypothesis of [...input.hypotheses].sort((left, right) =>
    stableCompare(left.id, right.id),
  )) {
    input.checkpoint();
    const claim = ledger.getClaim(hypothesis.claimId);
    if (!claim) invalidInput("Hypothesis references an unknown claim.", hypothesis.id);
    const evaluation = evaluateClaim({
      claim,
      evidence: input.evidence,
      facts: input.facts,
      requirements: hypothesis.requiredEvidence,
    }, input.checkpoint, input.validationContext);
    allRequiredEvidenceSatisfied &&= evaluation.allRequiredSatisfied;
    if (
      evaluation.hypothesisDisposition === "unresolved" &&
      hypothesis.status === "open"
    ) {
      continue;
    }
    ledger.applyClaimEvaluation({
      hypothesisId: hypothesis.id,
      evaluation,
      blockingContradictionIds: contradictions
        .filter(
          (record) =>
            record.claimId === hypothesis.claimId &&
            record.status === "open" &&
            record.severity === "blocking",
        )
        .map((record) => record.id),
      reason: "Deterministic claim evidence was reevaluated.",
      occurredAt: input.occurredAt,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    });
  }
  const hypothesisClaimIds = new Set(input.hypotheses.map((hypothesis) => hypothesis.claimId));
  claims = claims.map((claim) => {
    input.checkpoint();
    if (hypothesisClaimIds.has(claim.id)) return ledger.getClaim(claim.id)!;
    const evaluation = evaluateClaim({
      claim,
      evidence: input.evidence,
      facts: input.facts,
      requirements: [],
    }, input.checkpoint, input.validationContext);
    return evaluation.claim;
  });
  const hypotheses = ledger.snapshot();
  const evaluatedClaimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const existingFindingIds = new Set(input.findings.map((finding) => finding.id));
  input.checkpoint();
  const candidateFindings = mergeRecords(
    input.findings,
    deriveImplementationFindings({
      snapshot: input.snapshot,
      request: input.request,
      claims,
      hypotheses,
      facts: input.facts,
      evidence: input.evidence,
      operation: input.operation,
      operationRecords: input.operationRecords,
      checkpoint: input.checkpoint,
    }).filter((finding) => !existingFindingIds.has(finding.id)),
    "Deterministic finding",
  );
  const evaluatedFindings = candidateFindings.map((rawFinding) => {
    input.checkpoint();
    const finding = cloneDomainValue(rawFinding);
    const matchingEvidence = input.evidence.filter((record) => {
      if (
        record.role !== "supports" ||
        !record.freshness.current ||
        record.strength === "lead" ||
        (record.claimId !== undefined &&
          evaluatedClaimsById.get(record.claimId)?.status !== "supported")
      ) {
        return false;
      }
      return record.factIds.some((factId) => {
        const fact = factsById.get(factId);
        return fact !== undefined &&
          (finding.entityIds.includes(fact.subject.id) ||
            (fact.kind === "relation" && finding.entityIds.includes(fact.object.id)));
      });
    });
    finding.evidenceIds = sortedUnique([
      ...finding.evidenceIds,
      ...matchingEvidence.map((record) => record.id),
    ]);
    if (
      finding.status === "probable" &&
      matchingEvidence.length > 0 &&
      !finding.limitations.includes("distinguishing_owner_basis_missing")
    ) {
      finding.status = "confirmed";
    }
    return finding;
  });
  const findingEvaluations = evaluatedFindings
    .map((finding) => {
      input.checkpoint();
      return evaluateFindingEligibility({
        finding,
        snapshotId: input.snapshotId,
        evidence: input.evidence,
        facts: input.facts,
        entities: input.entities,
        contradictions,
        knowledgeGaps: input.knowledgeGaps,
      }, input.validationContext);
    })
    .sort((left, right) => stableCompare(left.finding.id, right.finding.id));
  input.checkpoint();
  return {
    claims: [...claims].sort((left, right) => stableCompare(left.id, right.id)),
    hypotheses,
    contradictions,
    findings: findingEvaluations.map((evaluation) => evaluation.finding),
    findingEvaluations,
    allRequiredEvidenceSatisfied,
  };
}

function plannerStateFor(
  input: InvestigationRunnerInput,
  state: MutableRunnerState,
) {
  return {
    snapshotId: input.snapshot.id,
    snapshot: input.snapshot,
    ...(input.request === undefined
      ? {}
      : { taskUnderstanding: input.request.task }),
    explicitTargets: input.request?.explicitTargets ?? [],
    negativeConstraints: input.request?.negativeConstraints ?? [],
    questions: state.questions,
    claims: state.claims,
    hypotheses: state.hypotheses,
    evidence: state.evidence,
    facts: state.facts,
    contradictions: state.contradictions,
    knowledgeGaps: state.knowledgeGaps,
    findings: state.findings,
    entities: state.entities,
    coverage: state.coverage,
    budgetState: state.budgetState,
    operationCandidates: state.operationCandidates,
    operationRecords: state.operationRecords,
    policy: input.plannerPolicy,
    repositoryChanged: state.repositoryChanged,
  };
}

function refreshGroundedOperationCandidates(
  input: InvestigationRunnerInput,
  state: MutableRunnerState,
): void {
  const derived = deriveGroundedOperationCandidates(plannerStateFor(input, state));
  state.operationCandidates = mergeCompatibleOperations(
    input.snapshot.id,
    derived.map((candidate) => candidate.operation),
  );
}

function plannerHasOpenOperation(
  input: InvestigationRunnerInput,
  state: MutableRunnerState,
): boolean {
  return state.operationCandidates.some(
    (operation) => isOperationRetryEligible({
      operation,
      operationRecords: state.operationRecords,
      maxFailedOperationRetries: input.plannerPolicy.maxFailedOperationRetries,
      budgetState: state.budgetState,
      grounded: true,
      repositoryChanged: state.repositoryChanged,
    }),
  );
}

function stopState(
  input: InvestigationRunnerInput,
  state: MutableRunnerState,
): Parameters<ReturnType<typeof createStopPolicy>["evaluate"]>[0] {
  const repositoryResolvableGapIds = sortedUnique(
    state.knowledgeGaps
      .filter(
        (gap) =>
          gap.status === "open" &&
          gap.category !== "ambiguous_user_intent" &&
          gap.suggestedOperations.length > 0,
      )
      .map((gap) => gap.id),
  );
  return {
    snapshotId: input.snapshot.id,
    purpose: input.purpose,
    coverage: state.coverage,
    budgetState: state.budgetState,
    evidence: state.evidence,
    facts: state.facts,
    findingEvaluations: state.findingEvaluations,
    contradictions: state.contradictions,
    knowledgeGaps: state.knowledgeGaps,
    criticalQuestionsNonApplicable: 0,
    allRequiredEvidenceSatisfied: state.allRequiredEvidenceSatisfied,
    internalInvariantFailure: false,
    repositoryChanged: state.repositoryChanged,
    safetyBlocked: state.safetyBlocked,
    deterministicResolutionAvailable: plannerHasOpenOperation(input, state),
    snapshotTruncationBlocksCritical: state.knowledgeGaps.some(
      (gap) =>
        gap.status === "open" &&
        gap.category === "snapshot_truncated" &&
        gap.blocks.length > 0,
    ),
    searchExhausted: state.searchExhausted,
    openDeterministicOperationCount: plannerHasOpenOperation(input, state) ? 1 : 0,
    repositoryResolvableGapIds,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function finalResult(
  input: InvestigationRunnerInput,
  state: MutableRunnerState,
  stop: InvestigationStop,
): InvestigationRunnerResult {
  return deepFreeze(
    cloneDomainValue({
      investigationId: input.investigationId,
      snapshotId: input.snapshot.id,
      phase: "stopped" as const,
      questions: [...state.questions].sort((left, right) => stableCompare(left.id, right.id)),
      claims: [...state.claims].sort((left, right) => stableCompare(left.id, right.id)),
      hypotheses: [...state.hypotheses].sort((left, right) => stableCompare(left.id, right.id)),
      entities: [...state.entities].sort((left, right) => stableCompare(left.id, right.id)),
      facts: [...state.facts].sort((left, right) => stableCompare(left.id, right.id)),
      evidence: [...state.evidence].sort((left, right) => stableCompare(left.id, right.id)),
      findings: [...state.findings].sort((left, right) => stableCompare(left.id, right.id)),
      contradictions: [...state.contradictions].sort((left, right) => stableCompare(left.id, right.id)),
      knowledgeGaps: [...state.knowledgeGaps].sort((left, right) => stableCompare(left.id, right.id)),
      coverage: state.coverage,
      budgetState: state.budgetState,
      operationRecords: state.operationRecords,
      trace: state.trace,
      stop,
      safeToProject: stop.safeToProject,
    }),
  );
}

function validateInitialInput(rawInput: InvestigationRunnerInput): InvestigationRunnerInput {
  const input = cloneDomainValue(rawInput);
  assertClosedRecord(
    input,
    INPUT_FIELDS,
    INPUT_FIELDS.filter(
      (field) => field !== "deadlineMonotonicMs" && field !== "request",
    ),
    "Investigation runner input",
  );
  assertPortableIdentifier(input.investigationId, "Investigation id");
  if (!PURPOSES.has(input.purpose)) invalidInput("Investigation purpose is unsupported.");
  if (input.deadlineMonotonicMs !== undefined) {
    assertSafeInteger(input.deadlineMonotonicMs, "Investigation deadline");
  }
  const snapshotValidation = validateRepositorySnapshot(input.snapshot);
  if (!snapshotValidation.valid) {
    invalidInput("Repository snapshot failed CE2 runtime validation.", input.snapshot.id);
  }
  if (
    input.request !== undefined &&
    (input.request.snapshot.id !== input.snapshot.id ||
      input.request.purpose !== input.purpose ||
      stableSerialize(input.request.snapshot) !== stableSerialize(input.snapshot))
  ) {
    invalidInput("Investigation request does not match the runner snapshot or purpose.");
  }
  for (const [value, label] of [
    [input.questions, "questions"],
    [input.claims, "claims"],
    [input.hypotheses, "hypotheses"],
    [input.entities, "entities"],
    [input.facts, "facts"],
    [input.evidence, "evidence"],
    [input.findings, "findings"],
    [input.contradictions, "contradictions"],
    [input.knowledgeGaps, "knowledge gaps"],
    [input.operationCandidates, "operation candidates"],
  ] as const) {
    if (!Array.isArray(value)) invalidInput(`Investigation ${label} must be a dense array.`);
  }
  return input;
}

function failedOutcome(
  operation: InvestigationOperation,
  code: string,
  message: string,
  retryable = false,
): OperationOutcome {
  return {
    ...emptyOutcome(operation),
    status: "failed",
    error: safeOperationError(code, message, retryable),
  };
}

async function executeRead(
  dependencies: InvestigationRunnerDependencies,
  input: InvestigationRunnerInput,
  operation: Extract<InvestigationOperation, { type: "read_file" | "read_range" }>,
  file: FileDescriptor,
  maxBytes: number,
): Promise<RepositoryReadResult> {
  const request = {
    snapshotId: input.snapshot.id,
    fileId: file.id,
    path: file.normalizedPath,
    expectedFingerprint: file.contentFingerprint,
    maxBytes,
  };
  const raw = operation.type === "read_range"
    ? await dependencies.repositoryReader.readRange({
        ...request,
        startLine: operation.startLine,
        endLine: operation.endLine,
      })
    : await dependencies.repositoryReader.readFile(request);
  return validateReadResult(raw, input.snapshot.id, file, operation, maxBytes);
}

function invalidReadOutcome(
  operation: InvestigationOperation,
  error: InvalidOperationResultBoundaryError,
): OperationOutcome {
  return {
    ...failedOutcome(
      operation,
      "invalid_operation_result",
      "Repository read output failed safe byte or range integrity validation.",
    ),
    actualCost: canonicalCost(operation, {
      fileReads: 1,
      fileBytes: error.accountedBytes,
      parsedFiles: 0,
    }),
  };
}

function readFailureOutcome(
  input: InvestigationRunnerInput,
  operation: InvestigationOperation,
  result: Extract<RepositoryReadResult, { status: "failure" }>,
): OperationOutcome {
  const attemptedReadCost = canonicalCost(operation, {
    fileReads: 1,
    fileBytes: 0,
    parsedFiles: 0,
  });
  if (result.reason === "fingerprint_mismatch") {
    return {
      ...failedOutcome(operation, "repository_changed", "Repository content no longer matches the active snapshot."),
      actualCost: attemptedReadCost,
      repositoryChanged: true,
    };
  }
  if (result.reason === "restricted") {
    return {
      ...failedOutcome(operation, "safety_blocked", "Repository access policy blocked the requested source."),
      status: "blocked",
      actualCost: attemptedReadCost,
      safetyBlocked: true,
      gaps: [
        operationGap(
          input.snapshot.id,
          operation,
          "safety_restricted",
          "A repository source required by this investigation is safety restricted.",
          ["authorization", "finding", "projection"],
        ),
      ],
    };
  }
  return {
    ...failedOutcome(
      operation,
      result.reason,
      "Repository source could not be read through the authorized boundary.",
      result.retryable === true,
    ),
    actualCost: attemptedReadCost,
    gaps: [
      operationGap(
        input.snapshot.id,
        operation,
        "unreadable_source",
        "A repository source required by this investigation could not be read.",
        operation.questionIds.length > 0 ? ["finding"] : [],
      ),
    ],
  };
}

async function executeOperation(
  dependencies: InvestigationRunnerDependencies,
  input: InvestigationRunnerInput,
  state: MutableRunnerState,
  operation: InvestigationOperation,
  readCache: Map<FileDescriptor["id"], ReadCacheEntry>,
  checkpoint: () => void,
): Promise<OperationOutcome> {
  checkpoint();
  const constrainedPath =
    operation.type === "read_file" ||
    operation.type === "read_range" ||
    operation.type === "parse_file" ||
    operation.type === "inspect_manifest"
      ? operation.path
      : undefined;
  if (
    constrainedPath !== undefined &&
    pathMatchesNegativeConstraints(
      constrainedPath,
      input.request?.negativeConstraints ?? [],
    )
  ) {
    return failedOutcome(
      operation,
      "negative_constraint",
      "Repository path is excluded by an explicit negative constraint.",
    );
  }
  if (
    operation.type === "evaluate_absence" &&
    operation.scopes.some((scope) =>
      pathMatchesNegativeConstraints(
        scope,
        input.request?.negativeConstraints ?? [],
      ),
    )
  ) {
    return failedOutcome(
      operation,
      "negative_constraint",
      "Bounded search scope is excluded by an explicit negative constraint.",
    );
  }
  if (operation.safetyClassification !== "safe") {
    return {
      ...failedOutcome(operation, "safety_blocked", "Operation is not permitted by its safety classification."),
      status: "blocked",
      safetyBlocked: true,
      gaps: [
        operationGap(
          input.snapshot.id,
          operation,
          "safety_restricted",
          "A grounded repository operation is blocked by access safety policy.",
          ["authorization", "finding", "projection"],
        ),
      ],
    };
  }
  if (
    operation.type === "search_paths" ||
    operation.type === "search_text" ||
    operation.type === "search_symbols"
  ) {
    const query = {
      snapshotId: input.snapshot.id,
      query: operation.query,
      limit: input.plannerPolicy.searchResultLimit,
    };
    const rawResults = operation.type === "search_paths"
      ? await dependencies.repositorySearch.searchPaths(query)
      : operation.type === "search_text"
        ? await dependencies.repositorySearch.searchText(query)
        : await dependencies.repositorySearch.searchSymbols(query);
    const results = validateSearchResults(rawResults, input.snapshot.id, input.snapshot.files)
      .filter(
        (result) =>
          !pathMatchesNegativeConstraints(
            result.path,
            input.request?.negativeConstraints ?? [],
          ),
      )
      .slice(0, input.plannerPolicy.searchResultLimit);
    const outcome = emptyOutcome(operation);
    outcome.consideredPaths = results.map((result) => result.path);
    outcome.evidence = results
      .filter((result): result is SearchResult & { source: SourceSpan } => result.source !== undefined)
      .map((result) => sourceOnlyEvidence(input.snapshot.id, operation, result.source));
    outcome.candidates = results.map((result) => {
      const file = fileForPath(input.snapshot.files, result.path)!;
      return createDeterministicOperation(input.snapshot.id, {
        type: "read_file",
        path: file.normalizedPath,
        reason: "Verify a snapshot-grounded repository search lead.",
        questionIds: sortedUnique(operation.questionIds),
        hypothesisIds: sortedUnique(operation.hypothesisIds),
        priority: operation.priority,
        estimatedCost: {
          ...ZERO_COST,
          operations: 1,
          fileReads: 1,
          fileBytes: file.sizeBytes,
        },
        safetyClassification:
          file.secretRisk === "known" || !file.readable ? "blocked" : "safe",
      });
    });
    return outcome;
  }

  if (operation.type === "read_file" || operation.type === "read_range") {
    const file = fileForPath(input.snapshot.files, operation.path);
    if (!file) {
      return {
        ...failedOutcome(operation, "repository_changed", "Operation path is absent from the active snapshot."),
        repositoryChanged: true,
      };
    }
    if (!file.readable || file.secretRisk === "known") {
      return {
        ...failedOutcome(operation, "safety_blocked", "Snapshot file is not authorized for reading."),
        status: "blocked",
        safetyBlocked: file.secretRisk === "known",
        gaps: [
          operationGap(
            input.snapshot.id,
            operation,
            file.secretRisk === "known" ? "safety_restricted" : "unreadable_source",
            file.secretRisk === "known"
              ? "A required repository source is safety restricted."
              : "A required repository source is marked unreadable in the active snapshot.",
            file.secretRisk === "known" ? ["authorization", "finding", "projection"] : ["finding"],
          ),
        ],
      };
    }
    const remainingBytes = Math.max(
      0,
      state.budgetState.budget.maxFileBytes - state.budgetState.usage.fileBytes,
    );
    let result: RepositoryReadResult;
    try {
      result = await executeRead(
        dependencies,
        input,
        operation,
        file,
        Math.min(remainingBytes, operation.estimatedCost.fileBytes),
      );
    } catch (error) {
      if (error instanceof InvalidOperationResultBoundaryError) {
        return invalidReadOutcome(operation, error);
      }
      throw error;
    }
    if (result.status === "failure") return readFailureOutcome(input, operation, result);
    if (!verifyReadSuccess(
      result,
      file,
      Math.min(remainingBytes, operation.estimatedCost.fileBytes),
    )) {
      return {
        ...failedOutcome(operation, "repository_changed", "Repository read fingerprint or byte bound is inconsistent."),
        repositoryChanged: result.contentFingerprint !== file.contentFingerprint,
      };
    }
    const outcome = emptyOutcome(operation);
    outcome.consideredPaths = [file.normalizedPath];
    outcome.readPaths = [file.normalizedPath];
    outcome.actualCost = canonicalCost(operation, {
      fileReads: 1,
      fileBytes: result.bytesRead,
    });
    if (operation.type === "read_file") {
      readCache.set(file.id, { result: cloneDomainValue(result) });
      const ownerClaimIds = new Set(state.claims
        .filter((claim) => claim.type === "implementation_owner")
        .map((claim) => claim.id));
      const servesOwner = state.hypotheses.some((hypothesis) =>
        ownerClaimIds.has(hypothesis.claimId) && operation.hypothesisIds.includes(hypothesis.id));
      const source = sourceFromRead(input.snapshot.id, result);
      const documentIdentity = servesOwner && input.request
        ? createExactDocumentIdentity({
          context: {
            normalizedTask: input.request.task.normalizedTask,
            explicitTargets: input.request.explicitTargets,
            negativeConstraints: input.request.negativeConstraints,
          },
          file,
          source,
          operation,
          observedAt: dependencies.clock.nowIso(),
        })
        : null;
      if (documentIdentity) {
        outcome.entities = [documentIdentity.entity];
        outcome.facts = [documentIdentity.fact];
        outcome.evidence = routeFactEvidence({
          snapshot: input.snapshot,
          request: input.request,
          operation,
          operationRecords: state.operationRecords,
          claims: state.claims,
          hypotheses: state.hypotheses,
          allFacts: mergeRecords(state.facts, [documentIdentity.fact], "Document identity fact"),
          producedFacts: [documentIdentity.fact],
          checkpoint,
        });
      } else {
        outcome.candidates = [
          createDeterministicOperation(input.snapshot.id, {
            type: "parse_file",
            path: file.normalizedPath,
            reason: "Extract deterministic facts from snapshot-verified content.",
            questionIds: sortedUnique(operation.questionIds),
            hypothesisIds: sortedUnique(operation.hypothesisIds),
            priority: operation.priority,
            estimatedCost: { ...ZERO_COST, operations: 1, parsedFiles: 1 },
            safetyClassification: "safe",
          }),
        ];
      }
    } else {
      const source = sourceFromRead(input.snapshot.id, result);
      assertSourceSpanEvaluationConsistency({ span: source, snapshotId: input.snapshot.id });
      outcome.evidence = [sourceOnlyEvidence(input.snapshot.id, operation, source)];
    }
    return outcome;
  }

  if (operation.type === "parse_file" || operation.type === "inspect_manifest") {
    const file = fileForPath(input.snapshot.files, operation.path);
    if (!file) {
      return {
        ...failedOutcome(operation, "repository_changed", "Parse path is absent from the active snapshot."),
        repositoryChanged: true,
      };
    }
    let cached = readCache.get(file.id)?.result;
    let readBytes = 0;
    let fileReads = 0;
    if (!cached) {
      if (!file.readable || file.secretRisk === "known") {
        return {
          ...failedOutcome(operation, "safety_blocked", "Snapshot file is not authorized for parsing."),
          status: "blocked",
          safetyBlocked: file.secretRisk === "known",
          gaps: [
            operationGap(
              input.snapshot.id,
              operation,
              file.secretRisk === "known" ? "safety_restricted" : "unreadable_source",
              "A repository source required for deterministic parsing is unavailable.",
              ["finding"],
            ),
          ],
        };
      }
      const remainingBytes = Math.max(
        0,
        state.budgetState.budget.maxFileBytes - state.budgetState.usage.fileBytes,
      );
      const readOperation = createDeterministicOperation(input.snapshot.id, {
        type: "read_file",
        path: file.normalizedPath,
        reason: "Authorize content for deterministic parsing.",
        questionIds: sortedUnique(operation.questionIds),
        hypothesisIds: sortedUnique(operation.hypothesisIds),
        priority: operation.priority,
        estimatedCost: { ...ZERO_COST },
        safetyClassification: "safe",
      }) as Extract<InvestigationOperation, { type: "read_file" }>;
      let result: RepositoryReadResult;
      try {
        result = await executeRead(
          dependencies,
          input,
          readOperation,
          file,
          Math.min(remainingBytes, operation.estimatedCost.fileBytes),
        );
      } catch (error) {
        if (error instanceof InvalidOperationResultBoundaryError) {
          return invalidReadOutcome(operation, error);
        }
        throw error;
      }
      if (result.status === "failure") return readFailureOutcome(input, operation, result);
      if (!verifyReadSuccess(
        result,
        file,
        Math.min(remainingBytes, operation.estimatedCost.fileBytes),
      )) {
        return {
          ...failedOutcome(operation, "repository_changed", "Parse read no longer matches the active snapshot."),
          repositoryChanged: result.contentFingerprint !== file.contentFingerprint,
        };
      }
      cached = result;
      readBytes = result.bytesRead;
      fileReads = 1;
    }
    const extractorInput = {
      snapshotId: input.snapshot.id,
      fileId: file.id,
      path: file.normalizedPath,
      content: cached.content,
      contentFingerprint: cached.contentFingerprint,
      language: file.language,
    };
    if (!dependencies.factExtractor.supports(extractorInput)) {
      return {
        ...failedOutcome(operation, "unsupported_extractor", "No deterministic extractor supports this snapshot file."),
        gaps: [
          operationGap(
            input.snapshot.id,
            operation,
            "missing_behavior",
            "No registered deterministic extractor can inspect a required repository source.",
            ["finding"],
          ),
        ],
        actualCost: canonicalCost(operation, { fileReads, fileBytes: readBytes, parsedFiles: 0 }),
      };
    }
    const rawExtraction = await dependencies.factExtractor.extract(extractorInput);
    let extraction;
    try {
      extraction = assertExtractionResultBoundToInput({
        result: rawExtraction,
        extractorInput,
        operation,
        snapshot: input.snapshot,
        negativeConstraints: input.request?.negativeConstraints ?? [],
      });
    } catch {
      return {
        ...failedOutcome(
          operation,
          "invalid_operation_result",
          "Fact extraction output failed the authorized input boundary.",
        ),
        actualCost: canonicalCost(operation, {
          fileReads,
          fileBytes: readBytes,
          parsedFiles: 1,
        }),
      };
    }
    const entities = extraction.entities;
    const facts = extraction.facts.map((fact) => ({
      ...fact,
      provenance: {
        ...fact.provenance,
        operationId: operation.id,
      },
    }));
    entities.forEach((entity) => {
      assertEntityEvaluationConsistency({ entity, snapshotId: input.snapshot.id });
      assertRepositoryEntitySnapshotConsistency(entity, input.snapshot);
    });
    facts.forEach((fact) => {
      assertFactEvaluationConsistency({ fact, snapshotId: input.snapshot.id });
      assertFactSnapshotConsistency(fact, input.snapshot);
    });
    const allFacts = mergeRecords(state.facts, facts, "Fact evidence routing");
    const evidence = routeFactEvidence({
      snapshot: input.snapshot,
      request: input.request,
      operation,
      operationRecords: state.operationRecords,
      claims: state.claims,
      hypotheses: state.hypotheses,
      allFacts,
      producedFacts: facts,
      checkpoint,
    });
    const outcome = emptyOutcome(operation);
    outcome.entities = entities;
    outcome.facts = facts;
    outcome.evidence = evidence;
    outcome.consideredPaths = [file.normalizedPath];
    outcome.readPaths = fileReads > 0 ? [file.normalizedPath] : [];
    outcome.parsedPaths = [file.normalizedPath];
    outcome.actualCost = canonicalCost(operation, {
      fileReads,
      fileBytes: readBytes,
      parsedFiles: 1,
    });
    if (extraction.limitations.length > 0) {
      outcome.gaps = [
        operationGap(
          input.snapshot.id,
          operation,
          "missing_behavior",
          "Deterministic extraction reported an unsupported or partial repository construct.",
          facts.length === 0 ? ["finding"] : [],
        ),
      ];
    }
    return outcome;
  }

  if (operation.type === "follow_relationship") {
    const source = state.entities.find((entity) => entity.id === operation.fromEntityId);
    if (!source) return failedOutcome(operation, "unknown_entity", "Relationship source entity is unknown.");
    const edges: KnowledgeEdge[] = [];
    let frontier = [source.id];
    const visited = new Set(frontier);
    for (let hop = 0; hop < operation.maxHops && frontier.length > 0; hop += 1) {
      checkpoint();
      const next: RepositoryEntity["id"][] = [];
      for (const entityId of [...frontier].sort(stableCompare)) {
        for (const predicate of operation.predicates) {
          checkpoint();
          const result = cloneDomainValue(
            await dependencies.graphStore.getNeighbors({
              snapshotId: input.snapshot.id,
              entityId,
              direction: "outgoing",
              predicate,
            }),
          );
          for (const edge of result) {
            checkpoint();
            assertFactEvaluationConsistency({ fact: edge.fact, snapshotId: input.snapshot.id });
            assertFactSnapshotConsistency(edge.fact, input.snapshot);
            assertEntityEvaluationConsistency({ entity: edge.source, snapshotId: input.snapshot.id });
            assertEntityEvaluationConsistency({ entity: edge.target, snapshotId: input.snapshot.id });
            edges.push(edge);
            if (!visited.has(edge.target.id)) {
              visited.add(edge.target.id);
              next.push(edge.target.id);
            }
          }
        }
      }
      frontier = sortedUnique(next);
    }
    const uniqueFacts = mergeRecords([], edges.map((edge) => edge.fact), "Relationship fact");
    const outcome = emptyOutcome(operation);
    outcome.evidence = routeFactEvidence({
      snapshot: input.snapshot,
      request: input.request,
      operation,
      operationRecords: state.operationRecords,
      claims: state.claims,
      hypotheses: state.hypotheses,
      allFacts: mergeRecords(state.facts, uniqueFacts, "Relationship evidence routing"),
      producedFacts: uniqueFacts,
      checkpoint,
    });
    outcome.relationshipHops = Math.min(operation.maxHops, edges.length === 0 ? 0 : operation.maxHops);
    outcome.actualCost = canonicalCost(operation, {
      relationshipHops: outcome.relationshipHops,
    });
    if (edges.length === 0) {
      outcome.gaps = [
        operationGap(
          input.snapshot.id,
          operation,
          "missing_relationship",
          "No active deterministic relationship matched the bounded traversal.",
          ["finding"],
        ),
      ];
    }
    return outcome;
  }

  if (operation.type === "evaluate_absence") {
    const scopesExist = operation.scopes.every((scope) =>
      input.snapshot.files.some(
        (file) =>
          file.normalizedPath === scope || file.normalizedPath.startsWith(`${scope}/`),
      ),
    );
    if (!scopesExist) {
      return failedOutcome(
        operation,
        "unknown_target",
        "Bounded absence scope is absent from the active snapshot.",
      );
    }
    if (input.snapshot.truncation.truncated) {
      return {
        ...emptyOutcome(operation),
        gaps: [
          operationGap(
            input.snapshot.id,
            operation,
            "snapshot_truncated",
            "A bounded absence conclusion is blocked by incomplete snapshot coverage.",
            ["authorization", "finding", "projection"],
          ),
        ],
      };
    }
    const results = validateSearchResults(
      await dependencies.repositorySearch.searchText({
        snapshotId: input.snapshot.id,
        query: operation.query,
        limit: input.plannerPolicy.searchResultLimit,
      }),
      input.snapshot.id,
      input.snapshot.files,
    ).filter(
      (result) =>
        !pathMatchesNegativeConstraints(
          result.path,
          input.request?.negativeConstraints ?? [],
        ),
    );
    const outcome = emptyOutcome(operation);
    outcome.consideredPaths = results.map((result) => result.path);
    if (results.length > 0) {
      outcome.candidates = results.map((result) => {
        const file = fileForPath(input.snapshot.files, result.path)!;
        return createDeterministicOperation(input.snapshot.id, {
          type: "read_file",
          path: file.normalizedPath,
          reason: "Verify a bounded absence-search result.",
          questionIds: sortedUnique(operation.questionIds),
          hypothesisIds: sortedUnique(operation.hypothesisIds),
          priority: operation.priority,
          estimatedCost: {
            ...ZERO_COST,
            operations: 1,
            fileReads: 1,
            fileBytes: file.sizeBytes,
          },
          safetyClassification: file.secretRisk === "known" ? "blocked" : "safe",
        });
      });
    } else {
      outcome.gaps = [
        operationGap(
          input.snapshot.id,
          operation,
          "missing_behavior",
          "Search completeness is unavailable, so zero results do not establish repository absence.",
          ["authorization", "finding", "projection"],
        ),
      ];
    }
    return outcome;
  }

  return failedOutcome(
    operation,
    "unsupported_operation",
    "This deterministic runner has no authorized execution port for the operation type.",
  );
}

export function createInvestigationRunner(
  dependencies: InvestigationRunnerDependencies,
): InvestigationRunner {
  const deterministicPlanner: DeterministicInvestigationPlanner =
    dependencies.planner ?? createDeterministicInvestigationPlanner();
  const planner = dependencies.actionPlanner ?? {
    async proposeNextOperations(state: Parameters<DeterministicInvestigationPlanner["proposeNextOperations"]>[0]) {
      return deterministicPlanner.proposeNextOperations(state);
    },
  };
  return {
    async run(rawInput) {
      let input: InvestigationRunnerInput;
      try {
        input = validateInitialInput(rawInput);
      } catch (error) {
        if (error instanceof InvestigationRunnerError) throw error;
        throw new InvestigationRunnerError(
          "invalid_input",
          "Investigation runner input failed safe runtime validation.",
        );
      }
      const startedAt = dependencies.clock.monotonicMs();
      const initialTimestamp = dependencies.clock.nowIso();
      assertCanonicalUtcTimestamp(initialTimestamp, "Investigation runner timestamp");
      let checkpointCount = 0;
      const checkCancellation = (force = false): void => {
        checkpointCount += 1;
        if (!force && checkpointCount % 16 !== 0) return;
        if (dependencies.cancellation.isCancellationRequested()) {
          throw new InvestigationRunnerError(
            "cancelled",
            "Investigation execution was cancelled by the caller boundary.",
          );
        }
        if (
          input.deadlineMonotonicMs !== undefined &&
          dependencies.clock.monotonicMs() >= input.deadlineMonotonicMs
        ) {
          throw new InvestigationRunnerError(
            "deadline_exceeded",
            "Investigation execution exceeded its monotonic deadline.",
          );
        }
      };
      const checkpoint = (): void => checkCancellation(false);
      const yieldToEventLoop = async (): Promise<void> => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        checkCancellation(true);
      };
      checkCancellation(true);
      const seed = input.request
        ? createDeterministicInvestigationInterpreter().interpret(input.request)
        : {
            questions: [],
            claims: [],
            hypotheses: [],
            knowledgeGaps: [],
            operationCandidates: [],
            rationale: [],
          };
      const initialQuestions = mergeRecords(
        input.questions,
        seed.questions,
        "Initial investigation question",
      );
      const initialClaims = mergeRecords(
        input.claims,
        seed.claims,
        "Initial claim",
      );
      const initialHypotheses = mergeRecords(
        input.hypotheses,
        seed.hypotheses,
        "Initial hypothesis",
      );
      let entities: readonly RepositoryEntity[] = mergeRecords(
        input.entities,
        deriveEntities(input.facts),
        "Initial repository entity",
      );
      entities.forEach((entity) => {
        checkpoint();
        assertEntityEvaluationConsistency({ entity, snapshotId: input.snapshot.id });
        assertRepositoryEntitySnapshotConsistency(entity, input.snapshot);
      });
      let facts: readonly FactRecord[] = [
        ...indexDomainRecordsById(input.facts, "Initial fact").values(),
      ];
      facts.forEach((fact) => {
        checkpoint();
        assertFactEvaluationConsistency({ fact, snapshotId: input.snapshot.id });
        try {
          assertFactSnapshotConsistency(fact, input.snapshot);
        } catch (error) {
          if (error instanceof InvariantViolationError) {
            invalidInput("Initial fact failed active snapshot consistency.", fact.id);
          }
          throw error;
        }
      });
      const evidenceLedger = createEvidenceLedger({ snapshot: input.snapshot, facts }, checkpoint);
      evidenceLedger.addMany(input.evidence);
      let evidence: readonly EvidenceRecord[] = evidenceLedger.snapshot();
      let validationContext = createValidatedDomainContext({
        snapshot: input.snapshot,
        entities,
        facts,
        evidence,
      }, checkpoint);
      entities = validationContext.entities;
      facts = validationContext.facts;
      evidence = validationContext.evidence;
      let gaps = mergeRecords(
        input.knowledgeGaps,
        seed.knowledgeGaps,
        "Initial knowledge gap",
      );
      if (
        input.snapshot.truncation.truncated &&
        (initialQuestions.some(
          (question) => question.priority === "critical" && question.status !== "answered",
        ) ||
          [...input.operationCandidates, ...seed.operationCandidates].some(
            (operation) => operation.type === "evaluate_absence",
          ))
      ) {
        gaps = mergeRecords(
          gaps,
          [
            {
              id: deterministicApplicationId("gap", {
                snapshotId: input.snapshot.id,
                category: "snapshot_truncated",
              }) as KnowledgeGap["id"],
              snapshotId: input.snapshot.id,
              category: "snapshot_truncated",
              question: "Does omitted snapshot scope contain evidence required by a critical question?",
              blocks: ["authorization", "finding", "projection"],
              relatedEntityIds: [],
              relatedHypothesisIds: [],
              suggestedOperations: [],
              status: "open",
            },
          ],
          "Initial knowledge gap",
        );
      }
      const gapRegistry = createKnowledgeGapRegistry({
        snapshotId: input.snapshot.id,
        knownEntityIds: entities.map((entity) => entity.id),
        knownHypothesisIds: initialHypotheses.map((hypothesis) => hypothesis.id),
      });
      gaps.forEach((gap) => {
        checkpoint();
        gapRegistry.add(gap);
      });
      gaps = gapRegistry.snapshot();
      const initialDomain = rebuildDomainState({
        snapshotId: input.snapshot.id,
        snapshot: input.snapshot,
        request: input.request,
        operationRecords: [],
        claims: initialClaims,
        hypotheses: initialHypotheses,
        facts,
        evidence,
        contradictions: [...indexDomainRecordsById(input.contradictions, "Initial contradiction").values()],
        knowledgeGaps: gaps,
        entities,
        findings: [...indexDomainRecordsById(input.findings, "Initial finding").values()],
        occurredAt: initialTimestamp,
        checkpoint,
        validationContext,
      });
      await yieldToEventLoop();
      const initialGapEvaluation = evaluateKnowledgeGapResolution({
        snapshot: input.snapshot,
        gaps,
        claims: initialDomain.claims,
        hypotheses: initialDomain.hypotheses,
        facts,
        evidence,
        findings: initialDomain.findings,
        operationRecords: [],
      });
      gaps = initialGapEvaluation.gaps;
      checkCancellation(true);
      const initialDomainAfterGaps = rebuildDomainState({
        snapshotId: input.snapshot.id,
        snapshot: input.snapshot,
        request: input.request,
        operationRecords: [],
        claims: initialDomain.claims,
        hypotheses: initialDomain.hypotheses,
        facts,
        evidence,
        contradictions: initialDomain.contradictions,
        knowledgeGaps: gaps,
        entities,
        findings: initialDomain.findings,
        occurredAt: initialTimestamp,
        checkpoint,
        validationContext,
      });
      await yieldToEventLoop();
      const initialQuestionEvaluation = evaluateInvestigationQuestions({
        snapshotId: input.snapshot.id,
        questions: initialQuestions,
        claims: initialDomainAfterGaps.claims,
        facts,
        evidence,
        findings: initialDomainAfterGaps.findings,
        findingEvaluations: initialDomainAfterGaps.findingEvaluations,
        knowledgeGaps: gaps,
        operationRecords: [],
      });
      const initialCandidates = mergeCompatibleOperations(
        input.snapshot.id,
        [...input.operationCandidates, ...seed.operationCandidates].map((operation) =>
          validateOperation(operation, input.snapshot.id),
        ),
      );
      let state: MutableRunnerState = {
        questions: initialQuestionEvaluation.questions,
        claims: initialDomainAfterGaps.claims,
        hypotheses: initialDomainAfterGaps.hypotheses,
        entities,
        facts,
        evidence,
        validationContext,
        findings: initialDomainAfterGaps.findings,
        findingEvaluations: initialDomainAfterGaps.findingEvaluations,
        contradictions: initialDomainAfterGaps.contradictions,
        knowledgeGaps: gaps,
        operationCandidates: initialCandidates,
        operationRecords: [],
        trace: [
          ...(input.request === undefined
            ? []
            : [{
                type: "seed_interpreted" as const,
                questionIds: seed.questions.map((question) => question.id),
                hypothesisIds: seed.hypotheses.map((hypothesis) => hypothesis.id),
                knowledgeGapIds: seed.knowledgeGaps.map((gap) => gap.id),
                operationIds: seed.operationCandidates.map((operation) => operation.id),
                rationaleCount: seed.rationale.length,
                negativeConstraintCount: input.request.negativeConstraints.length,
                semanticNegativeConstraintCount: input.request.negativeConstraints.filter(
                  (constraint) => constraint.kind === "semantic",
                ).length,
              }]),
          ...initialGapEvaluation.decisions.map((decision) => ({
            type: "gap_evaluated" as const,
            round: 0,
            ...decision,
          })),
          ...initialQuestionEvaluation.updates.map((update) => ({
            type: "question_updated" as const,
            round: 0,
            ...update,
          })),
          {
            type: "domain_evaluated" as const,
            round: 0,
            supportedHypothesisIds: initialDomainAfterGaps.hypotheses
              .filter((hypothesis) => hypothesis.status === "supported")
              .map((hypothesis) => hypothesis.id),
            confirmedFindingIds: initialDomainAfterGaps.findings
              .filter((finding) => finding.status === "confirmed")
              .map((finding) => finding.id),
            openGapIds: gaps.filter((gap) => gap.status === "open").map((gap) => gap.id),
          },
        ],
        budgetState: createInvestigationBudgetState(input.budget),
        coverage: {} as InvestigationCoverage,
        filesConsidered: [],
        filesRead: [],
        filesParsed: [],
        relationshipHops: 0,
        allRequiredEvidenceSatisfied: initialDomainAfterGaps.allRequiredEvidenceSatisfied,
        repositoryChanged: false,
        safetyBlocked: false,
        searchExhausted: false,
      };
      state.coverage = calculateCoverage(input, state);
      refreshGroundedOperationCandidates(input, state);
      await dependencies.graphStore.beginSnapshot(input.snapshot);
      await dependencies.graphStore.putBatch({
        snapshotId: input.snapshot.id,
        entities: [...entities],
        facts: [...facts],
      });
      const stopPolicy = createStopPolicy();
      const readCache = new Map<FileDescriptor["id"], ReadCacheEntry>();
      let round = 0;
      let accountedWallTime = 0;

      const synchronizeWallTime = (): void => {
        const elapsed = Math.max(0, dependencies.clock.monotonicMs() - startedAt);
        if (!Number.isSafeInteger(elapsed)) {
          throw new InvestigationRunnerError(
            "invalid_input",
            "Caller clock returned an invalid monotonic duration.",
          );
        }
        const delta = elapsed - accountedWallTime;
        if (delta > 0) {
          state.budgetState = applyOperationCost(state.budgetState, {
            ...ZERO_COST,
            wallTimeMs: delta,
          });
          accountedWallTime = elapsed;
        }
      };

      const checkStop = (
        stage: Extract<
          InvestigationRunnerTraceEvent,
          { type: "stop_checked" }
        >["stage"],
      ): InvestigationStop | null => {
        synchronizeWallTime();
        const decision = stopPolicy.evaluate(
          stopState(input, state),
          state.validationContext,
        );
        state.trace.push({
          type: "stop_checked",
          round,
          stage,
          decision: decision.action,
          ...(decision.action === "stop" ? { stopReason: decision.stop.reason } : {}),
        });
        return decision.action === "stop" ? decision.stop : null;
      };

      let stop = checkStop("before_planning");
      if (stop) {
        state.trace.push({
          type: "stop_checked",
          round,
          stage: "final",
          decision: "stop",
          stopReason: stop.reason,
        });
        return finalResult(input, state, stop);
      }

      while (!stop) {
        await yieldToEventLoop();
        const plannerRoundCost = { ...ZERO_COST, plannerRounds: 1 };
        if (!canFitOperationCost(state.budgetState, plannerRoundCost)) {
          state.budgetState = applyOperationCost(state.budgetState, {
            ...ZERO_COST,
            plannerRounds: Math.max(
              0,
              state.budgetState.budget.maxPlannerRounds -
                state.budgetState.usage.plannerRounds,
            ),
          });
          stop = checkStop("before_planning");
          break;
        }
        round += 1;
        refreshGroundedOperationCandidates(input, state);
        const plan = await planner.proposeNextOperations(
          plannerStateFor(input, state),
          dependencies.plannerSignal,
        );
        checkCancellation(true);
        state.operationCandidates = mergeCompatibleOperations(
          input.snapshot.id,
          [...state.operationCandidates, ...plan.operations],
        );
        state.trace.push({
          type: "plan_created",
          round,
          rationale: plan.rationale,
          consideredQuestionIds: plan.consideredQuestionIds,
          consideredHypothesisIds: plan.consideredHypothesisIds,
          consideredKnowledgeGapIds: plan.consideredKnowledgeGapIds,
          proposedOperationIds: plan.operations.map((operation) => operation.id),
          skippedDuplicateOperationIds: plan.skippedDuplicateOperationIds,
        });
        plan.synthesizedOperationSources.forEach((entry) => {
          const synthesized = plan.operations.find(
            (operation) => operation.id === entry.operationId,
          );
          if (!synthesized) return;
          state.trace.push({
            type: "planner_proposal_synthesized",
            round,
            operationId: synthesized.id,
            operationType: synthesized.type,
            source: entry.source,
            questionIds: synthesized.questionIds,
            hypothesisIds: synthesized.hypothesisIds,
          });
        });
        if (!plan.productive) {
          state.searchExhausted = true;
          state.budgetState = applyOperationCost(state.budgetState, plannerRoundCost);
          stop = checkStop("after_planning");
          continue;
        }
        stop = checkStop("after_planning");
        if (stop) {
          state.budgetState = applyOperationCost(state.budgetState, plannerRoundCost);
          stop = checkStop("after_budget") ?? stop;
          break;
        }
        const queue = createDeterministicOperationQueue();
        queue.enqueue(plan.operations);
        let operation = queue.dequeue();
        while (operation && !stop) {
          await yieldToEventLoop();
          stop = checkStop("before_operation");
          if (stop) break;
          operation = withCanonicalOperationCost({
            operation,
            snapshot: input.snapshot,
            hasVerifiedReadCache:
              (operation.type === "parse_file" || operation.type === "inspect_manifest") &&
              fileForPath(input.snapshot.files, operation.path) !== undefined &&
              readCache.has(fileForPath(input.snapshot.files, operation.path)!.id),
          });
          if (!canFitOperationCost(state.budgetState, operation.estimatedCost)) {
            state.trace.push({
              type: "operation_budget_rejected",
              round,
              operationId: operation.id,
            });
            state.operationRecords.push({
              operation: cloneDomainValue(operation),
              status: "skipped",
              producedEntityIds: [],
              producedFactIds: [],
              producedEvidenceIds: [],
              error: safeOperationError(
                "budget_rejected",
                "Operation estimated cost exceeds the remaining investigation budget.",
              ),
            });
            operation = queue.dequeue();
            continue;
          }
          state.trace.push({
            type: "operation_selected",
            round,
            operationId: operation.id,
            operationType: operation.type,
          });
          const operationStartedAt = dependencies.clock.nowIso();
          assertCanonicalUtcTimestamp(operationStartedAt, "Operation start timestamp");
          let outcome: OperationOutcome;
          try {
            outcome = await executeOperation(
              dependencies,
              input,
              state,
              operation,
              readCache,
              checkpoint,
            );
            checkCancellation(true);
          } catch (error) {
            if (error instanceof InvestigationRunnerError) throw error;
            outcome = error instanceof RepositoryChangedBoundaryError
              ? {
                  ...failedOutcome(
                    operation,
                    "repository_changed",
                    "Repository operation output no longer matches the active snapshot.",
                  ),
                  repositoryChanged: true,
                }
              : failedOutcome(
                  operation,
                  "operation_failed",
                  "Repository operation or result validation failed safely.",
                );
          }
          if (
            !actualCostFitsReservation(outcome.actualCost, operation.estimatedCost) ||
            !canFitOperationCost(state.budgetState, outcome.actualCost)
          ) {
            outcome = failedOutcome(
              operation,
              "invalid_operation_result",
              "Operation actual cost exceeded its canonical preflight reservation.",
            );
          }
          state.budgetState = applyOperationCost(state.budgetState, outcome.actualCost);
          const appliedOperationCost = cloneDomainValue(outcome.actualCost);
          let producedEntities: RepositoryEntity[] = [];
          let producedFacts: FactRecord[] = [];
          let producedEvidence: EvidenceRecord[] = [];
          if (outcome.status === "completed") {
            try {
              const candidateValidationContext = state.validationContext.extend({
                entities: [...outcome.entities, ...deriveEntities(outcome.facts)],
                facts: outcome.facts,
                evidence: outcome.evidence,
              }, checkpoint);
              const candidateEntities = candidateValidationContext.entities;
              const candidateFacts = candidateValidationContext.facts;
              const candidateEvidence = candidateValidationContext.evidence;
              const candidateGapRegistry = createKnowledgeGapRegistry({
                snapshotId: input.snapshot.id,
                knownEntityIds: candidateEntities.map((entity) => entity.id),
                knownHypothesisIds: state.hypotheses.map((hypothesis) => hypothesis.id),
              });
              state.knowledgeGaps.forEach((gap) => {
                checkpoint();
                candidateGapRegistry.add(gap);
              });
              outcome.gaps.forEach((gap) => {
                checkpoint();
                candidateGapRegistry.add(gap);
              });
              const unevaluatedGaps = candidateGapRegistry.snapshot();
              const occurredAt = dependencies.clock.nowIso();
              assertCanonicalUtcTimestamp(occurredAt, "Operation ingestion timestamp");
              const provisionalRecord: InvestigationOperationRecord = {
                operation: cloneDomainValue(operation),
                status: "completed",
                actualCost: cloneDomainValue(outcome.actualCost),
                producedEntityIds: sortedUnique(outcome.entities.map((entity) => entity.id)),
                producedFactIds: sortedUnique(outcome.facts.map((fact) => fact.id)),
                producedEvidenceIds: sortedUnique(outcome.evidence.map((record) => record.id)),
              };
              const provisionalDomain = rebuildDomainState({
                snapshotId: input.snapshot.id,
                snapshot: input.snapshot,
                request: input.request,
                operation,
                operationRecords: [...state.operationRecords, provisionalRecord],
                claims: state.claims,
                hypotheses: state.hypotheses,
                facts: candidateFacts,
                evidence: candidateEvidence,
                contradictions: state.contradictions,
                knowledgeGaps: unevaluatedGaps,
                entities: candidateEntities,
                findings: state.findings,
                occurredAt,
                operationId: operation.id,
                checkpoint,
                validationContext: candidateValidationContext,
              });
              await yieldToEventLoop();
              const gapEvaluation = evaluateKnowledgeGapResolution({
                snapshot: input.snapshot,
                gaps: unevaluatedGaps,
                claims: provisionalDomain.claims,
                hypotheses: provisionalDomain.hypotheses,
                facts: candidateFacts,
                evidence: candidateEvidence,
                findings: provisionalDomain.findings,
                operationRecords: [...state.operationRecords, provisionalRecord],
              });
              checkCancellation(true);
              const domain = rebuildDomainState({
                snapshotId: input.snapshot.id,
                snapshot: input.snapshot,
                request: input.request,
                operation,
                operationRecords: [...state.operationRecords, provisionalRecord],
                claims: provisionalDomain.claims,
                hypotheses: provisionalDomain.hypotheses,
                facts: candidateFacts,
                evidence: candidateEvidence,
                contradictions: provisionalDomain.contradictions,
                knowledgeGaps: gapEvaluation.gaps,
                entities: candidateEntities,
                findings: provisionalDomain.findings,
                occurredAt,
                operationId: operation.id,
                checkpoint,
                validationContext: candidateValidationContext,
              });
              await yieldToEventLoop();
              const questionEvaluation = evaluateInvestigationQuestions({
                snapshotId: input.snapshot.id,
                questions: state.questions,
                claims: domain.claims,
                facts: candidateFacts,
                evidence: candidateEvidence,
                findings: domain.findings,
                findingEvaluations: domain.findingEvaluations,
                knowledgeGaps: gapEvaluation.gaps,
                operationRecords: [...state.operationRecords, provisionalRecord],
              });
              const candidateState = {
                ...state,
                trace: [...state.trace],
                questions: questionEvaluation.questions,
                entities: candidateEntities,
                facts: candidateFacts,
                evidence: candidateEvidence,
                validationContext: candidateValidationContext,
                claims: domain.claims,
                hypotheses: domain.hypotheses,
                contradictions: domain.contradictions,
                knowledgeGaps: gapEvaluation.gaps,
                findings: domain.findings,
                findingEvaluations: domain.findingEvaluations,
                allRequiredEvidenceSatisfied: domain.allRequiredEvidenceSatisfied,
                operationCandidates: mergeCompatibleOperations(
                  input.snapshot.id,
                  [
                    ...state.operationCandidates,
                    ...outcome.candidates.map((candidate) =>
                      validateOperation(candidate, input.snapshot.id),
                    ),
                  ],
                ),
                filesConsidered: sortedUnique([
                  ...state.filesConsidered,
                  ...outcome.consideredPaths,
                ]),
                filesRead: sortedUnique([...state.filesRead, ...outcome.readPaths]),
                filesParsed: sortedUnique([...state.filesParsed, ...outcome.parsedPaths]),
                relationshipHops: state.relationshipHops + outcome.relationshipHops,
                repositoryChanged: state.repositoryChanged || outcome.repositoryChanged,
                safetyBlocked: state.safetyBlocked || outcome.safetyBlocked,
              } satisfies MutableRunnerState;
              candidateState.coverage = calculateCoverage(input, candidateState);
              checkCancellation(true);
              const graphEntities = mergeRecords(
                [],
                [...outcome.entities, ...deriveEntities(outcome.facts)],
                "Atomic operation entity",
              );
              await dependencies.graphStore.putBatch({
                snapshotId: input.snapshot.id,
                entities: graphEntities,
                facts: outcome.facts,
              });
              producedEntities = outcome.entities;
              producedFacts = outcome.facts;
              producedEvidence = outcome.evidence;
              state = candidateState;
              state.trace.push({
                type: "atomic_commit",
                round,
                operationId: operation.id,
                status: "committed",
                entityIds: sortedUnique(graphEntities.map((entity) => entity.id)),
                factIds: sortedUnique(outcome.facts.map((fact) => fact.id)),
              });
              gapEvaluation.decisions.forEach((decision) => {
                state.trace.push({
                  type: "gap_evaluated",
                  round,
                  ...decision,
                });
              });
              questionEvaluation.updates.forEach((update) => {
                state.trace.push({
                  type: "question_updated",
                  round,
                  ...update,
                });
              });
              state.trace.push({
                type: "domain_evaluated",
                round,
                supportedHypothesisIds: domain.hypotheses
                  .filter((hypothesis) => hypothesis.status === "supported")
                  .map((hypothesis) => hypothesis.id),
                confirmedFindingIds: domain.findings
                  .filter((finding) => finding.status === "confirmed")
                  .map((finding) => finding.id),
                openGapIds: gapEvaluation.gaps
                  .filter((gap) => gap.status === "open")
                  .map((gap) => gap.id),
              });
            } catch (error) {
              if (error instanceof InvestigationRunnerError) throw error;
              state.trace.push({
                type: "atomic_commit",
                round,
                operationId: operation.id,
                status: "rejected",
                entityIds: [],
                factIds: [],
              });
              outcome = {
                ...failedOutcome(
                  operation,
                  "invalid_operation_result",
                  "Operation ingestion failed domain validation atomically.",
                ),
                actualCost: appliedOperationCost,
              };
            }
          }
          if (outcome.status !== "completed") {
            const candidateGapRegistry = createKnowledgeGapRegistry({
              snapshotId: input.snapshot.id,
              knownEntityIds: state.entities.map((entity) => entity.id),
              knownHypothesisIds: state.hypotheses.map((hypothesis) => hypothesis.id),
            });
            state.knowledgeGaps.forEach((gap) => candidateGapRegistry.add(gap));
            outcome.gaps.forEach((gap) => candidateGapRegistry.add(gap));
            state.knowledgeGaps = candidateGapRegistry.snapshot();
            state.repositoryChanged ||= outcome.repositoryChanged;
            state.safetyBlocked ||= outcome.safetyBlocked;
            const failedQuestionEvaluation = evaluateInvestigationQuestions({
              snapshotId: input.snapshot.id,
              questions: state.questions,
              claims: state.claims,
              facts: state.facts,
              evidence: state.evidence,
              findings: state.findings,
              findingEvaluations: state.findingEvaluations,
              knowledgeGaps: state.knowledgeGaps,
              operationRecords: [
                ...state.operationRecords,
                {
                  operation,
                  status: outcome.status,
                  actualCost: outcome.actualCost,
                  producedEntityIds: [],
                  producedFactIds: [],
                  producedEvidenceIds: [],
                  ...(outcome.error === undefined ? {} : { error: outcome.error }),
                },
              ],
            });
            state.questions = failedQuestionEvaluation.questions;
            failedQuestionEvaluation.updates.forEach((update) => {
              state.trace.push({
                type: "question_updated",
                round,
                ...update,
              });
            });
            state.coverage = calculateCoverage(input, state);
          }
          const record: InvestigationOperationRecord = {
            operation: cloneDomainValue(operation),
            status: outcome.status,
            startedAt: operationStartedAt,
            completedAt: dependencies.clock.nowIso(),
            actualCost: outcome.actualCost,
            producedEntityIds: sortedUnique(producedEntities.map((entity) => entity.id)),
            producedFactIds: sortedUnique(producedFacts.map((fact) => fact.id)),
            producedEvidenceIds: sortedUnique(producedEvidence.map((record) => record.id)),
            ...(outcome.error === undefined ? {} : { error: outcome.error }),
          };
          assertCanonicalUtcTimestamp(record.startedAt, "Operation start timestamp");
          assertCanonicalUtcTimestamp(record.completedAt, "Operation completion timestamp");
          state.operationRecords.push(record);
          state.trace.push({
            type: "operation_completed",
            round,
            operationId: operation.id,
            status: record.status,
            producedEntityIds: record.producedEntityIds,
            producedFactIds: record.producedFactIds,
            producedEvidenceIds: record.producedEvidenceIds,
          });
          stop = checkStop("after_ingestion");
          if (!stop) stop = checkStop("after_budget");
          operation = queue.dequeue();
        }
        state.budgetState = applyOperationCost(state.budgetState, plannerRoundCost);
        stop = checkStop("after_budget") ?? stop;
      }

      if (!stop) {
        stop = checkStop("final");
      } else {
        state.trace.push({
          type: "stop_checked",
          round,
          stage: "final",
          decision: "stop",
          stopReason: stop.reason,
        });
      }
      if (!stop) {
        throw new InvestigationRunnerError(
          "operation_failed",
          "Investigation runner ended without a canonical stop decision.",
        );
      }
      return finalResult(input, state, stop);
    },
  };
}
