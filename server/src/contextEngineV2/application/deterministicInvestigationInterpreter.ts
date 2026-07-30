import type {
  ClaimRecord,
  EvidenceRequirement,
  InvestigationOperation,
  InvestigationQuestion,
  InvestigationRequest,
  KnowledgeGap,
} from "../contracts/index.js";
import {
  InvariantViolationError,
  assertValidInvestigationRequest,
} from "../domain/index.js";
import {
  cloneDomainValue,
  sortedUnique,
  stableCompare,
} from "../domain/investigationDomainSupport.js";
import { isSecretLikeSemanticLiteral } from "../domain/semanticLiteralSafety.js";
import type {
  DeterministicInvestigationInterpreter,
  DeterministicInvestigationSeed,
  InvestigationSeedRationale,
} from "./investigationRunnerTypes.js";
import { InvestigationRunnerError } from "./investigationRunnerTypes.js";
import {
  createDeterministicOperation,
  deterministicApplicationId,
  mergeCompatibleOperations,
} from "./operationIdentity.js";
import { pathMatchesNegativeConstraints } from "./negativeConstraintMatcher.js";

const ZERO_COST = {
  operations: 0,
  fileReads: 0,
  fileBytes: 0,
  parsedFiles: 0,
  relationshipHops: 0,
  plannerRounds: 0,
  wallTimeMs: 0,
} as const;

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

type SeedDimension = InvestigationQuestion["category"];

function claimTypeFor(category: SeedDimension): ClaimRecord["type"] {
  switch (category) {
    case "owner":
      return "implementation_owner";
    case "behavior":
      return "behavior";
    case "data_flow":
      return "data_flow";
    case "route_flow":
      return "route_flow";
    case "state_flow":
      return "state_flow";
    case "constraint":
      return "configuration";
    case "test_coverage":
      return "test_coverage";
    case "risk":
      return "risk";
  }
}

function gapCategoryFor(category: SeedDimension): KnowledgeGap["category"] {
  switch (category) {
    case "owner":
      return "missing_owner";
    case "test_coverage":
      return "missing_test_evidence";
    case "data_flow":
    case "route_flow":
    case "state_flow":
      return "missing_relationship";
    case "constraint":
      return "missing_runtime_variant";
    case "behavior":
    case "risk":
      return "missing_behavior";
  }
}

function predicatesFor(category: SeedDimension, seedKey: unknown): string[] {
  switch (category) {
    case "owner":
      return ["calls", "contains", "defines_endpoint", "defines_route", "imports", "re_exports"];
    case "behavior":
      return ["calls", "contains", "defines_endpoint"];
    case "data_flow":
      return ["calls", "imports"];
    case "route_flow":
      return ["calls", "defines_endpoint", "imports", "re_exports"];
    case "state_flow":
      return ["calls", "contains", "imports"];
    case "constraint":
      return ["configuration"];
    case "test_coverage":
      return ["tests"];
    case "risk":
      return ["calls", "configuration", "imports"];
  }
}

function questionText(category: SeedDimension): string {
  switch (category) {
    case "owner":
      return "Which repository entity is the evidence-backed implementation owner?";
    case "behavior":
      return "Which current repository behavior must be preserved or changed?";
    case "data_flow":
      return "Which exact repository relationships carry the relevant data flow?";
    case "route_flow":
      return "Which exact route and call relationships reach the implementation owner?";
    case "state_flow":
      return "Which exact repository relationships own the relevant state flow?";
    case "constraint":
      return "Which current repository constraints apply to the requested change?";
    case "test_coverage":
      return "Which deterministic tests cover the relevant behavior?";
    case "risk":
      return "Which repository-backed risks constrain the requested change?";
  }
}

function safeTaskTokens(task: string): string[] {
  const matches = task.match(/[\p{L}_$][\p{L}\p{N}_.$-]{2,}/gu) ?? [];
  const safe = matches
    .map((value) => value.trim())
    .filter(
      (value) =>
        !GENERIC_STOP_WORDS.has(value.toLowerCase()) &&
        !isSecretLikeSemanticLiteral(value),
    );
  return sortedUnique(safe).slice(0, 3);
}

function requirementFor(
  category: SeedDimension,
  seedKey: unknown,
): EvidenceRequirement {
  return {
    id: deterministicApplicationId("requirement", { seedKey, category }),
    description: "Current deterministic evidence for this repository question is required.",
    acceptedFactPredicates: predicatesFor(category, seedKey).sort(stableCompare),
    minimumStrength: "substantial",
    minimumIndependentGroups: 1,
    required: true,
  };
}

export function createDeterministicInvestigationInterpreter(): DeterministicInvestigationInterpreter {
  return {
    interpret(rawRequest) {
      let request: InvestigationRequest;
      try {
        request = cloneDomainValue(rawRequest);
        assertValidInvestigationRequest(request);
      } catch (error) {
        if (error instanceof InvestigationRunnerError) throw error;
        if (error instanceof InvariantViolationError) {
          throw new InvestigationRunnerError(
            "invalid_input",
            "Investigation request failed deterministic interpreter validation.",
          );
        }
        throw new InvestigationRunnerError(
          "invalid_input",
          "Investigation request could not be interpreted safely.",
        );
      }

      const questions: DeterministicInvestigationSeed["questions"] = [];
      const claims: DeterministicInvestigationSeed["claims"] = [];
      const hypotheses: DeterministicInvestigationSeed["hypotheses"] = [];
      const knowledgeGaps: DeterministicInvestigationSeed["knowledgeGaps"] = [];
      const operationCandidates: InvestigationOperation[] = [];
      const rationale: InvestigationSeedRationale[] = [];
      const taskTokens = safeTaskTokens(request.task.normalizedTask);

      const addDimension = (input: {
        category: SeedDimension;
        priority: InvestigationQuestion["priority"];
        seedKey: unknown;
        source: InvestigationSeedRationale["source"];
        operation?: InvestigationOperation;
      }): void => {
        const questionId = deterministicApplicationId("question", {
          snapshotId: request.snapshot.id,
          category: input.category,
          seedKey: input.seedKey,
        }) as InvestigationQuestion["id"];
        const claimId = deterministicApplicationId("claim", {
          snapshotId: request.snapshot.id,
          category: input.category,
          seedKey: input.seedKey,
        }) as ClaimRecord["id"];
        const hypothesisId = deterministicApplicationId("hypothesis", {
          snapshotId: request.snapshot.id,
          claimId,
        }) as DeterministicInvestigationSeed["hypotheses"][number]["id"];
        const gapId = deterministicApplicationId("gap", {
          snapshotId: request.snapshot.id,
          questionId,
          category: gapCategoryFor(input.category),
        }) as KnowledgeGap["id"];
        const question: InvestigationQuestion = {
          id: questionId,
          text: questionText(input.category),
          category: input.category,
          priority: input.priority,
          status: "open",
          answerFindingIds: [],
        };
        const claim: ClaimRecord = {
          id: claimId,
          snapshotId: request.snapshot.id,
          type: claimTypeFor(input.category),
          statement: "A deterministic repository investigation must establish this semantic claim.",
          supportingEvidenceIds: [],
          contradictingEvidenceIds: [],
          status: "proposed",
          derivation: {
            ruleId: "ce2-04.deterministic-seed",
            ruleVersion: "1",
            inputFactIds: [],
          },
        };
        const normalizedOperation = input.operation
          ? {
              ...cloneDomainValue(input.operation),
              questionIds: [questionId],
              hypothesisIds: [hypothesisId],
            }
          : undefined;
        const gap: KnowledgeGap = {
          id: gapId,
          snapshotId: request.snapshot.id,
          category: gapCategoryFor(input.category),
          question: question.text,
          blocks:
            input.priority === "critical"
              ? ["authorization", "finding", "projection"]
              : ["finding"],
          relatedEntityIds: [],
          relatedHypothesisIds: [hypothesisId],
          suggestedOperations: normalizedOperation
            ? [
                {
                  type: normalizedOperation.type,
                  reason: normalizedOperation.reason,
                  questionIds: [questionId],
                  hypothesisIds: [hypothesisId],
                },
              ]
            : [],
          status: "open",
        };
        questions.push(question);
        claims.push(claim);
        hypotheses.push({
          id: hypothesisId,
          claimId,
          priority: input.priority,
          status: "open",
          requiredEvidence: [requirementFor(input.category, input.seedKey)],
          supportingEvidenceIds: [],
          contradictingEvidenceIds: [],
          openQuestionIds: [gapId],
          revision: 0,
          history: [],
        });
        knowledgeGaps.push(gap);
        if (normalizedOperation) operationCandidates.push(normalizedOperation);
        rationale.push({
          source: input.source,
          questionIds: [questionId],
          hypothesisIds: [hypothesisId],
          knowledgeGapIds: [gapId],
          operationIds: normalizedOperation ? [normalizedOperation.id] : [],
          reason: normalizedOperation
            ? "A deterministic seed was grounded in explicit or structured request input."
            : "The request created a semantic question without inventing a repository target.",
        });
      };

      for (const target of [...request.explicitTargets].sort((left, right) =>
        stableCompare(JSON.stringify(left), JSON.stringify(right)),
      )) {
        if (target.kind === "path") {
          const file = request.snapshot.files.find(
            (candidate) => candidate.normalizedPath === target.path,
          );
          if (
            file &&
            !pathMatchesNegativeConstraints(file.normalizedPath, request.negativeConstraints)
          ) {
            addDimension({
              category: "owner",
              priority: "critical",
              seedKey: { kind: "path", fileId: file.id },
              source: "explicit_path",
              operation: createDeterministicOperation(request.snapshot.id, {
                type: "read_file",
                path: file.normalizedPath,
                reason: "Verify an explicit snapshot-grounded path target.",
                questionIds: [],
                hypothesisIds: [],
                priority: 100,
                estimatedCost: {
                  ...ZERO_COST,
                  operations: 1,
                  fileReads: 1,
                  fileBytes: file.sizeBytes,
                },
                safetyClassification:
                  !file.readable || file.secretRisk === "known" ? "blocked" : "safe",
              }),
            });
          } else {
            addDimension({
              category: "owner",
              priority: "critical",
              seedKey: { kind: "unknown_path", targetHash: deterministicApplicationId("target", target.path) },
              source: "unknown_explicit_target",
            });
          }
        } else if (!isSecretLikeSemanticLiteral(target.symbol)) {
          addDimension({
            category: "owner",
            priority: "critical",
            seedKey: { kind: "symbol", targetHash: deterministicApplicationId("target", target.symbol) },
            source: "explicit_symbol",
            operation: createDeterministicOperation(request.snapshot.id, {
              type: "search_symbols",
              query: target.symbol,
              reason: "Search for an explicit symbol target from the request contract.",
              questionIds: [],
              hypothesisIds: [],
              priority: 100,
              estimatedCost: { ...ZERO_COST, operations: 1 },
              safetyClassification: "safe",
            }),
          });
        }
      }

      if (questions.length === 0) {
        const genericDimensions: Array<{
          category: SeedDimension;
          priority: InvestigationQuestion["priority"];
        }> = request.purpose === "implementation_context"
          ? [
              { category: "owner", priority: "critical" },
              { category: "behavior", priority: "high" },
            ]
          : request.purpose === "review_context"
            ? [
                { category: "behavior", priority: "critical" },
                { category: "risk", priority: "high" },
              ]
            : [{ category: "behavior", priority: "critical" }];
        genericDimensions.forEach(({ category, priority }, index) => {
          const query = taskTokens[index] ?? taskTokens[0];
          addDimension({
            category,
            priority,
            seedKey: { kind: "generic", category },
            source: query ? "task_token" : "generic_question",
            ...(query
              ? {
                  operation: createDeterministicOperation(request.snapshot.id, {
                    type: "search_text",
                    query,
                    reason: "Search an exact token grounded in the structured task understanding.",
                    questionIds: [],
                    hypothesisIds: [],
                    priority: priority === "critical" ? 90 : 70,
                    estimatedCost: { ...ZERO_COST, operations: 1 },
                    safetyClassification: "safe",
                  }),
                }
              : {}),
          });
        });
      }

      for (const reference of request.priorKnowledge ?? []) {
        rationale.push({
          source: "prior_knowledge_reference",
          questionIds: sortedUnique(questions.map((question) => question.id)),
          hypothesisIds: sortedUnique(hypotheses.map((hypothesis) => hypothesis.id)),
          knowledgeGapIds: [],
          operationIds: [],
          reason: reference.snapshotId === undefined || reference.snapshotId === request.snapshot.id
            ? "A prior-knowledge reference was retained as a lead without asserting repository facts."
            : "A cross-snapshot prior-knowledge reference requires revalidation before use.",
        });
      }

      const mergedOperations = mergeCompatibleOperations(
        request.snapshot.id,
        operationCandidates,
      );
      return cloneDomainValue({
        questions: [...questions].sort((left, right) => stableCompare(left.id, right.id)),
        claims: [...claims].sort((left, right) => stableCompare(left.id, right.id)),
        hypotheses: [...hypotheses].sort((left, right) => stableCompare(left.id, right.id)),
        knowledgeGaps: [...knowledgeGaps].sort((left, right) => stableCompare(left.id, right.id)),
        operationCandidates: mergedOperations,
        rationale: [...rationale].sort((left, right) =>
          stableCompare(JSON.stringify(left), JSON.stringify(right)),
        ),
      });
    },
  };
}
