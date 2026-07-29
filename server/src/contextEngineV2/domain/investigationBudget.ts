import type {
  InvestigationBudget,
  InvestigationBudgetLimit,
  InvestigationBudgetState,
  InvestigationBudgetUsage,
  OperationCost,
} from "../contracts/index.js";
import {
  InvestigationDomainError,
  assertClosedRecord,
  assertSafeInteger,
  cloneDomainValue,
} from "./investigationDomainSupport.js";

const BUDGET_FIELDS = [
  "maxOperations",
  "maxFileReads",
  "maxFileBytes",
  "maxParsedFiles",
  "maxRelationshipHops",
  "maxWallTimeMs",
  "maxPlannerRounds",
  "maxConcurrentOperations",
] as const;
const COST_FIELDS = [
  "operations",
  "fileReads",
  "fileBytes",
  "parsedFiles",
  "relationshipHops",
  "plannerRounds",
  "wallTimeMs",
] as const;
const LIMIT_ORDER: InvestigationBudgetLimit[] = [
  "operations",
  "file_reads",
  "file_bytes",
  "parsed_files",
  "relationship_hops",
  "wall_time",
  "planner_rounds",
];

const USAGE_TO_BUDGET: Readonly<
  Record<keyof InvestigationBudgetUsage, keyof InvestigationBudget>
> = {
  operations: "maxOperations",
  fileReads: "maxFileReads",
  fileBytes: "maxFileBytes",
  parsedFiles: "maxParsedFiles",
  relationshipHops: "maxRelationshipHops",
  plannerRounds: "maxPlannerRounds",
  wallTimeMs: "maxWallTimeMs",
};

const USAGE_TO_LIMIT: Readonly<
  Record<keyof InvestigationBudgetUsage, InvestigationBudgetLimit>
> = {
  operations: "operations",
  fileReads: "file_reads",
  fileBytes: "file_bytes",
  parsedFiles: "parsed_files",
  relationshipHops: "relationship_hops",
  plannerRounds: "planner_rounds",
  wallTimeMs: "wall_time",
};

function validateBudget(budget: InvestigationBudget): void {
  assertClosedRecord(budget, BUDGET_FIELDS, BUDGET_FIELDS, "Investigation budget");
  for (const field of BUDGET_FIELDS) {
    assertSafeInteger(budget[field], `Investigation budget ${field}`, {
      positive: field === "maxConcurrentOperations",
    });
  }
}

function validateCost(cost: OperationCost): void {
  assertClosedRecord(cost, COST_FIELDS, COST_FIELDS, "Operation cost");
  for (const field of COST_FIELDS) {
    assertSafeInteger(cost[field], `Operation cost ${field}`);
  }
}

function exhaustedFor(
  budget: InvestigationBudget,
  usage: InvestigationBudgetUsage,
): InvestigationBudgetLimit[] {
  const exhausted = new Set<InvestigationBudgetLimit>();
  for (const field of COST_FIELDS) {
    if (usage[field] >= budget[USAGE_TO_BUDGET[field]]) {
      exhausted.add(USAGE_TO_LIMIT[field]);
    }
  }
  return LIMIT_ORDER.filter((limit) => exhausted.has(limit));
}

export function createInvestigationBudgetState(
  budget: InvestigationBudget,
): InvestigationBudgetState {
  validateBudget(budget);
  const usage: InvestigationBudgetUsage = {
    operations: 0,
    fileReads: 0,
    fileBytes: 0,
    parsedFiles: 0,
    relationshipHops: 0,
    wallTimeMs: 0,
    plannerRounds: 0,
  };
  return {
    budget: cloneDomainValue(budget),
    usage,
    exhausted: exhaustedFor(budget, usage),
  };
}

function validateState(state: InvestigationBudgetState): void {
  assertClosedRecord(
    state,
    ["budget", "usage", "exhausted"],
    ["budget", "usage", "exhausted"],
    "Investigation budget state",
  );
  validateBudget(state.budget);
  assertClosedRecord(state.usage, COST_FIELDS, COST_FIELDS, "Investigation budget usage");
  for (const field of COST_FIELDS) {
    assertSafeInteger(state.usage[field], `Investigation usage ${field}`);
  }
  const expected = exhaustedFor(state.budget, state.usage);
  if (
    !Array.isArray(state.exhausted) ||
    state.exhausted.length !== expected.length ||
    state.exhausted.some((limit, index) => limit !== expected[index])
  ) {
    throw new InvestigationDomainError(
      "invalid_budget",
      "Investigation budget exhausted limits are inconsistent.",
    );
  }
}

export function canFitOperationCost(
  state: InvestigationBudgetState,
  estimatedCost: OperationCost,
): boolean {
  validateState(state);
  validateCost(estimatedCost);
  return COST_FIELDS.every((field) => {
    const projected = state.usage[field] + estimatedCost[field];
    if (!Number.isSafeInteger(projected)) {
      throw new InvestigationDomainError(
        "numeric_overflow",
        "Estimated investigation usage overflowed a safe integer.",
      );
    }
    return projected <= state.budget[USAGE_TO_BUDGET[field]];
  });
}

export function applyOperationCost(
  state: InvestigationBudgetState,
  cost: OperationCost,
): InvestigationBudgetState {
  validateState(state);
  validateCost(cost);
  const usage = cloneDomainValue(state.usage);
  for (const field of COST_FIELDS) {
    const next = usage[field] + cost[field];
    if (!Number.isSafeInteger(next)) {
      throw new InvestigationDomainError(
        "numeric_overflow",
        "Investigation budget usage overflowed a safe integer.",
      );
    }
    usage[field] = next;
  }
  return {
    budget: cloneDomainValue(state.budget),
    usage,
    exhausted: exhaustedFor(state.budget, usage),
  };
}

export function snapshotInvestigationBudget(
  state: InvestigationBudgetState,
): InvestigationBudgetState {
  validateState(state);
  return cloneDomainValue(state);
}
