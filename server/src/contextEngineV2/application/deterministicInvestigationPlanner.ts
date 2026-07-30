import type {
  FactRecord,
  FileDescriptor,
  InvestigationHypothesis,
  InvestigationOperation,
  InvestigationQuestion,
  RepositoryEntity,
} from "../contracts/index.js";
import { evaluateEvidenceRequirement } from "../domain/index.js";
import { isRepositoryRelativePath } from "../domain/invariant.js";
import {
  assertCanonicalUtcTimestamp,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeInteger,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  sortedUnique,
  stableCompare,
} from "../domain/investigationDomainSupport.js";
import { isSecretLikeSemanticLiteral } from "../domain/semanticLiteralSafety.js";
import { compareQueuedOperations } from "./deterministicOperationQueue.js";
import type {
  DeterministicInvestigationPlan,
  DeterministicInvestigationPlanner,
  DeterministicPlannerPolicy,
  DeterministicPlannerState,
  GroundedOperationSource,
} from "./investigationRunnerTypes.js";
import { InvestigationRunnerError } from "./investigationRunnerTypes.js";
import { withCanonicalOperationCost } from "./operationCost.js";
import {
  createDeterministicOperation,
  mergeCompatibleOperations,
  operationTargetKey,
  validateOperation,
} from "./operationIdentity.js";
import { pathMatchesNegativeConstraints } from "./negativeConstraintMatcher.js";
import { isOperationRetryEligible } from "./operationRetryPolicy.js";

const POLICY_FIELDS = [
  "maxOperationsPerRound",
  "searchResultLimit",
  "maxFailedOperationRetries",
] as const;
const OPERATION_RECORD_FIELDS = [
  "operation",
  "status",
  "startedAt",
  "completedAt",
  "actualCost",
  "producedEntityIds",
  "producedFactIds",
  "producedEvidenceIds",
  "error",
] as const;
const OPERATION_COST_FIELDS = [
  "operations",
  "fileReads",
  "fileBytes",
  "parsedFiles",
  "relationshipHops",
  "plannerRounds",
  "wallTimeMs",
] as const;
const OPERATION_STATUSES = new Set([
  "proposed",
  "scheduled",
  "running",
  "completed",
  "failed",
  "skipped",
  "blocked",
  "deduplicated",
]);
const EXACT_RELATIONSHIP_PREDICATES = new Set([
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
const SOURCE_ORDER: Readonly<Record<GroundedOperationSource, number>> = {
  explicit_path: 0,
  explicit_symbol: 1,
  search_lead: 2,
  graph_fact: 3,
  knowledge_gap: 4,
  snapshot_manifest: 5,
  task_token: 6,
  caller_seed: 7,
};
const GENERIC_STOP_WORDS = new Set([
  "add",
  "change",
  "create",
  "find",
  "implementation",
  "implement",
  "owner",
  "repository",
  "requested",
  "task",
  "the",
  "this",
  "where",
  "which",
]);

interface GroundedCandidate {
  operation: InvestigationOperation;
  source: GroundedOperationSource;
}

function validatePolicy(policy: DeterministicPlannerPolicy): void {
  assertClosedRecord(policy, POLICY_FIELDS, POLICY_FIELDS, "Deterministic planner policy");
  assertSafeInteger(policy.maxOperationsPerRound, "Planner operations per round", {
    positive: true,
  });
  assertSafeInteger(policy.searchResultLimit, "Planner search result limit", {
    positive: true,
  });
  assertSafeInteger(policy.maxFailedOperationRetries, "Planner failed retry limit");
}

function validateOperationRecords(state: DeterministicPlannerState): void {
  for (const record of state.operationRecords) {
    assertClosedRecord(
      record,
      OPERATION_RECORD_FIELDS,
      ["operation", "status", "producedEntityIds", "producedFactIds", "producedEvidenceIds"],
      "Investigation operation record",
    );
    validateOperation(record.operation, state.snapshotId);
    if (!OPERATION_STATUSES.has(record.status)) {
      throw new InvestigationRunnerError(
        "invalid_input",
        "Investigation operation status is unsupported.",
      );
    }
    if (record.startedAt !== undefined) {
      assertCanonicalUtcTimestamp(record.startedAt, "Operation start timestamp");
    }
    if (record.completedAt !== undefined) {
      assertCanonicalUtcTimestamp(record.completedAt, "Operation completion timestamp");
    }
    if (record.actualCost !== undefined) {
      assertClosedRecord(
        record.actualCost,
        OPERATION_COST_FIELDS,
        OPERATION_COST_FIELDS,
        "Operation actual cost",
      );
      OPERATION_COST_FIELDS.forEach((field) =>
        assertSafeInteger(record.actualCost![field], `Operation actual cost ${field}`),
      );
    }
    for (const [ids, label] of [
      [record.producedEntityIds, "Operation entity ids"],
      [record.producedFactIds, "Operation fact ids"],
      [record.producedEvidenceIds, "Operation evidence ids"],
    ] as const) {
      assertSortedUniqueStrings(ids, label);
      ids.forEach((id) => assertPortableIdentifier(id, label));
    }
    if (record.error !== undefined) {
      assertClosedRecord(
        record.error,
        ["code", "message", "retryable"],
        ["code", "message", "retryable"],
        "Operation safe error",
      );
      assertPortableIdentifier(record.error.code, "Operation error code");
      assertSafeText(record.error.message, "Operation error message");
      if (typeof record.error.retryable !== "boolean") {
        throw new InvestigationRunnerError(
          "invalid_input",
          "Operation error retryable flag must be boolean.",
        );
      }
    }
  }
}

function safeTaskTokens(task: string | undefined): string[] {
  if (!task) return [];
  return sortedUnique(
    (task.match(/[\p{L}_$][\p{L}\p{N}_.$-]{2,}/gu) ?? [])
      .filter(
        (value) =>
          !GENERIC_STOP_WORDS.has(value.toLowerCase()) &&
          !isSecretLikeSemanticLiteral(value),
      ),
  ).slice(0, 3);
}

function fileForPath(
  state: DeterministicPlannerState,
  path: string,
): FileDescriptor | undefined {
  return state.snapshot.files.find((file) => file.normalizedPath === path);
}

function verifiedReadExists(
  state: DeterministicPlannerState,
  path: string,
): boolean {
  return state.operationRecords.some(
    (record) =>
      record.status === "completed" &&
      record.operation.type === "read_file" &&
      record.operation.path === path,
  );
}

function purposeForFact(
  fact: FactRecord,
  state: DeterministicPlannerState,
): { questionIds: InvestigationQuestion["id"][]; hypothesisIds: InvestigationHypothesis["id"][] } {
  const operationId = fact.provenance.operationId;
  const record = operationId
    ? state.operationRecords.find((candidate) => candidate.operation.id === operationId)
    : undefined;
  if (record) {
    return {
      questionIds: sortedUnique(record.operation.questionIds),
      hypothesisIds: sortedUnique(record.operation.hypothesisIds),
    };
  }
  const hypothesisIds = sortedUnique(
    state.hypotheses
      .filter((hypothesis) => {
        const claim = state.claims.find((candidate) => candidate.id === hypothesis.claimId);
        return claim?.derivation.inputFactIds.includes(fact.id) ?? false;
      })
      .map((hypothesis) => hypothesis.id),
  );
  return { questionIds: [], hypothesisIds };
}

function normalizeModuleQuery(value: string): string | null {
  if (isSecretLikeSemanticLiteral(value)) return null;
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    return null;
  }
  const final = normalized.split("/").at(-1)?.replace(/\.(?:[cm]?[jt]sx?|json)$/iu, "");
  return final && final.length > 0 ? final : null;
}

function moduleSpecifierFromFact(fact: FactRecord): string | null {
  if (fact.kind !== "relation") return null;
  const value = fact.object.attributes?.moduleSpecifier;
  return typeof value === "string" ? normalizeModuleQuery(value) : null;
}

function createCandidate(
  state: DeterministicPlannerState,
  source: GroundedOperationSource,
  seed: Parameters<typeof createDeterministicOperation>[1],
): GroundedCandidate {
  const operation = createDeterministicOperation(state.snapshotId, seed);
  return {
    operation: withCanonicalOperationCost({
      operation,
      snapshot: state.snapshot,
      hasVerifiedReadCache:
        (operation.type === "parse_file" || operation.type === "inspect_manifest") &&
        verifiedReadExists(state, operation.path),
    }),
    source,
  };
}

function operationIsGrounded(
  operation: InvestigationOperation,
  state: DeterministicPlannerState,
): boolean {
  switch (operation.type) {
    case "read_file":
    case "read_range":
    case "parse_file":
    case "inspect_manifest":
      return fileForPath(state, operation.path) !== undefined &&
        !pathMatchesNegativeConstraints(operation.path, state.negativeConstraints);
    case "follow_relationship":
      return state.entities.some((entity) => entity.id === operation.fromEntityId) &&
        operation.predicates.every((predicate) => EXACT_RELATIONSHIP_PREDICATES.has(predicate));
    case "evaluate_absence":
      return !state.snapshot.truncation.truncated &&
        operation.scopes.length > 0 &&
        operation.scopes.every(
          (scope) =>
            !pathMatchesNegativeConstraints(scope, state.negativeConstraints),
        ) &&
        operation.scopes.every((scope) =>
          state.snapshot.files.some(
            (file) =>
              file.normalizedPath === scope || file.normalizedPath.startsWith(`${scope}/`),
          ),
        );
    case "inspect_git_context":
      return false;
    case "search_paths":
    case "search_symbols":
    case "search_text":
      return operation.query.length > 0 && !isSecretLikeSemanticLiteral(operation.query);
  }
}

function synthesizeGroundedCandidates(
  state: DeterministicPlannerState,
): GroundedCandidate[] {
  const candidates: GroundedCandidate[] = state.operationCandidates.map((raw) => {
    const operation = validateOperation(raw, state.snapshotId);
    return {
      operation: withCanonicalOperationCost({
        operation,
        snapshot: state.snapshot,
        hasVerifiedReadCache:
          (operation.type === "parse_file" || operation.type === "inspect_manifest") &&
          verifiedReadExists(state, operation.path),
      }),
      source:
        operation.reason === "Verify a snapshot-grounded repository search lead." ||
        operation.reason === "Extract deterministic facts from snapshot-verified content." ||
        operation.reason === "Verify a bounded absence-search result."
          ? "search_lead" as const
          : "caller_seed" as const,
    };
  });
  const openQuestions = state.questions.filter((question) => question.status !== "answered");

  for (const target of state.explicitTargets) {
    if (target.kind === "path") {
      const file = fileForPath(state, target.path);
      if (
        !file ||
        pathMatchesNegativeConstraints(file.normalizedPath, state.negativeConstraints)
      ) continue;
      candidates.push(createCandidate(state, "explicit_path", {
        type: "read_file",
        path: file.normalizedPath,
        reason: "Verify an explicit path against the active snapshot.",
        questionIds: sortedUnique(openQuestions.map((question) => question.id)),
        hypothesisIds: sortedUnique(state.hypotheses.filter((item) => item.status === "open").map((item) => item.id)),
        priority: 100,
        estimatedCost: { operations: 1, fileReads: 1, fileBytes: file.sizeBytes, parsedFiles: 0, relationshipHops: 0, plannerRounds: 0, wallTimeMs: 0 },
        safetyClassification: !file.readable || file.secretRisk === "known" ? "blocked" : "safe",
      }));
    } else if (!isSecretLikeSemanticLiteral(target.symbol)) {
      candidates.push(createCandidate(state, "explicit_symbol", {
        type: "search_symbols",
        query: target.symbol,
        reason: "Search an explicit symbol from the structured request.",
        questionIds: sortedUnique(openQuestions.map((question) => question.id)),
        hypothesisIds: sortedUnique(state.hypotheses.filter((item) => item.status === "open").map((item) => item.id)),
        priority: 100,
        estimatedCost: { operations: 1, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 0, plannerRounds: 0, wallTimeMs: 0 },
        safetyClassification: "safe",
      }));
    }
  }

  const taskTokens = safeTaskTokens(state.taskUnderstanding?.normalizedTask);
  for (const question of openQuestions.filter((item) => item.priority === "critical")) {
    const token = taskTokens[0];
    if (!token) continue;
    const hypothesisIds = sortedUnique(
      state.knowledgeGaps
        .filter((gap) =>
          gap.status === "open" &&
          (gap.question === question.text ||
            gap.suggestedOperations.some((proposal) => proposal.questionIds.includes(question.id))),
        )
        .flatMap((gap) => gap.relatedHypothesisIds),
    );
    candidates.push(createCandidate(state, "task_token", {
      type: "search_text",
      query: token,
      reason: "Search an exact token grounded in the structured task understanding.",
      questionIds: [question.id],
      hypothesisIds,
      priority: 90,
      estimatedCost: { operations: 1, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 0, plannerRounds: 0, wallTimeMs: 0 },
      safetyClassification: "safe",
    }));
  }

  const manifestQuestions = openQuestions.filter((question) =>
    new Set(["constraint", "data_flow", "owner", "risk"]).has(question.category),
  );
  if (manifestQuestions.length > 0) {
    for (const file of state.snapshot.files.filter((candidate) =>
      candidate.kind === "configuration" &&
      /(?:^|\/)(?:package|tsconfig)\.json$/u.test(candidate.normalizedPath) &&
      !pathMatchesNegativeConstraints(
        candidate.normalizedPath,
        state.negativeConstraints,
      ),
    )) {
      candidates.push(createCandidate(state, "snapshot_manifest", {
        type: "inspect_manifest",
        path: file.normalizedPath,
        reason: "Inspect a manifest descriptor present in the active snapshot.",
        questionIds: sortedUnique(manifestQuestions.map((question) => question.id)),
        hypothesisIds: sortedUnique(state.hypotheses.filter((item) => item.status === "open").map((item) => item.id)),
        priority: 60,
        estimatedCost: { operations: 1, fileReads: 1, fileBytes: file.sizeBytes, parsedFiles: 1, relationshipHops: 0, plannerRounds: 0, wallTimeMs: 0 },
        safetyClassification: !file.readable || file.secretRisk === "known" ? "blocked" : "safe",
      }));
    }
  }

  for (const gap of state.knowledgeGaps.filter((candidate) => candidate.status === "open")) {
    const questionIds = sortedUnique(gap.suggestedOperations.flatMap((proposal) => proposal.questionIds));
    const hypothesisIds = sortedUnique(gap.relatedHypothesisIds);
    const predicates = sortedUnique(
      state.hypotheses
        .filter((hypothesis) => hypothesisIds.includes(hypothesis.id))
        .flatMap((hypothesis) =>
          hypothesis.requiredEvidence.flatMap((requirement) => requirement.acceptedFactPredicates ?? []),
        )
        .filter((predicate) => EXACT_RELATIONSHIP_PREDICATES.has(predicate)),
    );
    for (const entityId of gap.relatedEntityIds) {
      if (!state.entities.some((entity) => entity.id === entityId) || predicates.length === 0) continue;
      candidates.push(createCandidate(state, "knowledge_gap", {
        type: "follow_relationship",
        fromEntityId: entityId,
        predicates,
        maxHops: 1,
        reason: "Follow exact graph relationships grounded by a blocking knowledge gap.",
        questionIds,
        hypothesisIds,
        priority: gap.blocks.length > 0 ? 80 : 50,
        estimatedCost: { operations: 1, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 1, plannerRounds: 0, wallTimeMs: 0 },
        safetyClassification: "safe",
      }));
    }
    const token = taskTokens[0];
    if (
      token &&
      gap.suggestedOperations.some((proposal) =>
        new Set(["search_paths", "search_symbols", "search_text"]).has(proposal.type),
      )
    ) {
      candidates.push(createCandidate(state, "knowledge_gap", {
        type: "search_text",
        query: token,
        reason: "Resolve a suggested search through a grounded task token.",
        questionIds,
        hypothesisIds,
        priority: gap.blocks.length > 0 ? 80 : 50,
        estimatedCost: { operations: 1, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 0, plannerRounds: 0, wallTimeMs: 0 },
        safetyClassification: "safe",
      }));
    }
  }

  for (const fact of state.facts.filter(
    (candidate) =>
      candidate.status === "active" &&
      candidate.kind === "relation" &&
      EXACT_RELATIONSHIP_PREDICATES.has(candidate.predicate),
  )) {
    const purpose = purposeForFact(fact, state);
    candidates.push(createCandidate(state, "graph_fact", {
      type: "follow_relationship",
      fromEntityId: fact.subject.id,
      predicates: [fact.predicate],
      maxHops: 1,
      reason: "Follow an exact active relationship already present in the graph.",
      questionIds: purpose.questionIds,
      hypothesisIds: purpose.hypothesisIds,
      priority: 55,
      estimatedCost: { operations: 1, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 1, plannerRounds: 0, wallTimeMs: 0 },
      safetyClassification: "safe",
    }));
    const moduleQuery = moduleSpecifierFromFact(fact);
    if (moduleQuery) {
      candidates.push(createCandidate(state, "graph_fact", {
        type: "search_paths",
        query: moduleQuery,
        reason: "Resolve an exact module specifier observed in an active relationship fact.",
        questionIds: purpose.questionIds,
        hypothesisIds: purpose.hypothesisIds,
        priority: 65,
        estimatedCost: { operations: 1, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 0, plannerRounds: 0, wallTimeMs: 0 },
        safetyClassification: "safe",
      }));
    }
  }

  const byTarget = new Map<string, GroundedCandidate[]>();
  for (const candidate of candidates) {
    if (!operationIsGrounded(candidate.operation, state)) continue;
    const key = `${candidate.operation.type}\0${operationTargetKey(candidate.operation)}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), candidate]);
  }
  return [...byTarget.values()]
    .map((group) => {
      const operation = mergeCompatibleOperations(
        state.snapshotId,
        group.map((candidate) => candidate.operation),
      )[0]!;
      const source = [...group]
        .map((candidate) => candidate.source)
        .sort((left, right) => SOURCE_ORDER[left] - SOURCE_ORDER[right])[0]!;
      return { operation, source };
    })
    .sort((left, right) => compareQueuedOperations(left.operation, right.operation));
}

function matchesHypothesis(
  operation: InvestigationOperation,
  hypothesis: InvestigationHypothesis,
): boolean {
  return operation.hypothesisIds.includes(hypothesis.id);
}

function gapMatchesOperation(
  operation: InvestigationOperation,
  gap: DeterministicPlannerState["knowledgeGaps"][number],
): boolean {
  return gap.relatedHypothesisIds.some((id) => operation.hypothesisIds.includes(id)) ||
    gap.relatedEntityIds.some(
      (id) => operation.type === "follow_relationship" && operation.fromEntityId === id,
    ) ||
    gap.suggestedOperations.some(
      (proposal) =>
        proposal.type === operation.type &&
        proposal.questionIds.every((id) => operation.questionIds.includes(id)) &&
        proposal.hypothesisIds.every((id) => operation.hypothesisIds.includes(id)),
    );
}

function operationTier(
  candidate: GroundedCandidate,
  state: DeterministicPlannerState,
): number {
  const operation = candidate.operation;
  if (candidate.source === "explicit_path" || candidate.source === "explicit_symbol") return 0;
  const questionsById = new Map(state.questions.map((question) => [question.id, question]));
  if (operation.questionIds.some((id) => {
    const question = questionsById.get(id);
    return question?.priority === "critical" && question.status !== "answered";
  })) return 1;
  const hypothesesById = new Map(state.hypotheses.map((item) => [item.id, item]));
  const blockingClaims = new Set(
    state.contradictions
      .filter((item) => item.status === "open" && item.severity === "blocking")
      .map((item) => item.claimId),
  );
  if (operation.hypothesisIds.some((id) => {
    const hypothesis = hypothesesById.get(id);
    return hypothesis ? blockingClaims.has(hypothesis.claimId) : false;
  })) return 2;
  if (state.knowledgeGaps.some(
    (gap) => gap.status === "open" && gap.blocks.length > 0 && gapMatchesOperation(operation, gap),
  )) return 3;
  const claimsById = new Map(state.claims.map((claim) => [claim.id, claim]));
  for (const hypothesis of state.hypotheses) {
    if (hypothesis.status !== "open" || !matchesHypothesis(operation, hypothesis)) continue;
    const claim = claimsById.get(hypothesis.claimId);
    if (!claim) continue;
    const supporting = state.evidence.filter(
      (record) => record.claimId === claim.id && record.role === "supports",
    );
    if (hypothesis.requiredEvidence.some(
      (requirement) => requirement.required && !evaluateEvidenceRequirement({
        requirement,
        evidence: supporting,
        facts: state.facts,
        snapshotId: state.snapshotId,
        role: "supports",
      }).satisfied,
    )) return 4;
  }
  if (operation.type === "follow_relationship") return 5;
  if (operation.questionIds.some((id) => {
    const category = questionsById.get(id)?.category;
    return category === "test_coverage" || category === "constraint";
  })) return 6;
  return 7;
}

function rationaleForTier(tier: number | undefined): string {
  switch (tier) {
    case 0: return "Verify an explicit snapshot-grounded target.";
    case 1: return "Resolve the highest-priority open critical repository question.";
    case 2: return "Resolve a blocking deterministic contradiction.";
    case 3: return "Resolve a blocking repository knowledge gap.";
    case 4: return "Gather required evidence for the highest-priority open hypothesis.";
    case 5: return "Expand an exact active repository relationship.";
    case 6: return "Gather bounded test or constraint evidence.";
    case 7: return "Gather optional grounded repository context.";
    default: return "No productive grounded deterministic operation remains.";
  }
}

export function deriveGroundedOperationCandidates(
  rawState: Readonly<DeterministicPlannerState>,
): Array<GroundedCandidate> {
  const state = cloneDomainValue(rawState as DeterministicPlannerState);
  validatePolicy(state.policy);
  validateOperationRecords(state);
  return synthesizeGroundedCandidates(state).map(cloneDomainValue);
}

export function createDeterministicInvestigationPlanner(): DeterministicInvestigationPlanner {
  return {
    proposeNextOperations(rawState) {
      const state = cloneDomainValue(rawState as DeterministicPlannerState);
      validatePolicy(state.policy);
      validateOperationRecords(state);
      const questionIds = new Set(state.questions.map((question) => question.id));
      const hypothesisIds = new Set(state.hypotheses.map((hypothesis) => hypothesis.id));
      const candidates = synthesizeGroundedCandidates(state);
      for (const candidate of candidates) {
        if (
          candidate.operation.questionIds.some((id) => !questionIds.has(id)) ||
          candidate.operation.hypothesisIds.some((id) => !hypothesisIds.has(id))
        ) {
          throw new InvestigationRunnerError(
            "invalid_input",
            "Operation purpose references an unknown question or hypothesis.",
          );
        }
      }
      const skipped: InvestigationOperation["id"][] = [];
      const eligible = candidates.filter((candidate) => {
        const operation = candidate.operation;
        const onlyResolvedGapGrounding = state.knowledgeGaps.some(
          (gap) => gap.status !== "open" && gapMatchesOperation(operation, gap),
        ) && !state.knowledgeGaps.some(
          (gap) => gap.status === "open" && gapMatchesOperation(operation, gap),
        ) && !operation.questionIds.some((id) =>
          state.questions.some((question) => question.id === id && question.status !== "answered"),
        ) && !operation.hypothesisIds.some((id) =>
          state.hypotheses.some((hypothesis) => hypothesis.id === id && hypothesis.status === "open"),
        );
        const retryEligible = isOperationRetryEligible({
          operation,
          operationRecords: state.operationRecords,
          maxFailedOperationRetries: state.policy.maxFailedOperationRetries,
          budgetState: state.budgetState,
          grounded: operationIsGrounded(operation, state),
          repositoryChanged: state.repositoryChanged,
        });
        if (!retryEligible || onlyResolvedGapGrounding) skipped.push(operation.id);
        return retryEligible && !onlyResolvedGapGrounding;
      });
      const ranked = eligible
        .map((candidate) => ({ candidate, tier: operationTier(candidate, state) }))
        .sort((left, right) =>
          left.tier - right.tier || compareQueuedOperations(left.candidate.operation, right.candidate.operation),
        );
      const selected = ranked.slice(0, state.policy.maxOperationsPerRound);
      const operations = selected.map(({ candidate }) => cloneDomainValue(candidate.operation));
      const plan: DeterministicInvestigationPlan = {
        rationale: rationaleForTier(selected[0]?.tier),
        operations,
        skippedDuplicateOperationIds: sortedUnique(skipped),
        consideredQuestionIds: sortedUnique(operations.flatMap((operation) => operation.questionIds)),
        consideredHypothesisIds: sortedUnique(operations.flatMap((operation) => operation.hypothesisIds)),
        consideredKnowledgeGapIds: sortedUnique(
          state.knowledgeGaps
            .filter((gap) => gap.status === "open" && operations.some((operation) => gapMatchesOperation(operation, gap)))
            .map((gap) => gap.id),
        ),
        synthesizedOperationSources: selected.map(({ candidate }) => ({
          operationId: candidate.operation.id,
          source: candidate.source,
        })),
        productive: operations.length > 0,
      };
      return cloneDomainValue(plan);
    },
  };
}
