import type {
  InvestigationBudgetState,
  InvestigationOperation,
  InvestigationOperationRecord,
} from "../contracts/index.js";
import { canFitOperationCost } from "../domain/index.js";
import { stableCompare, stableSerialize } from "../domain/investigationDomainSupport.js";

const TERMINAL_NON_RETRY_STATUSES = new Set<InvestigationOperationRecord["status"]>([
  "completed",
  "blocked",
  "skipped",
  "deduplicated",
]);

const NEVER_RETRY_ERROR_CODES = new Set([
  "repository_changed",
  "safety_blocked",
  "unknown_entity",
  "unknown_target",
  "unsupported_extractor",
  "invalid_operation_result",
  "invalid_input",
  "not_found",
  "binary",
  "range_invalid",
]);

export interface OperationRetryEligibilityInput {
  operation: InvestigationOperation;
  operationRecords: readonly InvestigationOperationRecord[];
  maxFailedOperationRetries: number;
  budgetState: InvestigationBudgetState;
  grounded: boolean;
  repositoryChanged: boolean;
}

export function isOperationRetryEligible(
  input: OperationRetryEligibilityInput,
): boolean {
  if (!input.grounded || input.repositoryChanged) return false;
  const records = input.operationRecords.filter(
    (record) => record.operation.deduplicationKey === input.operation.deduplicationKey,
  );
  if (records.some((record) => TERMINAL_NON_RETRY_STATUSES.has(record.status))) {
    return false;
  }
  const failures = records
    .filter((record) => record.status === "failed")
    .sort((left, right) =>
      stableCompare(
        `${left.completedAt ?? ""}\0${left.startedAt ?? ""}\0${stableSerialize(left.error ?? null)}`,
        `${right.completedAt ?? ""}\0${right.startedAt ?? ""}\0${stableSerialize(right.error ?? null)}`,
      ),
    );
  if (failures.length === 0) {
    return true;
  }
  const previous = failures.at(-1);
  if (
    !previous?.error?.retryable ||
    NEVER_RETRY_ERROR_CODES.has(previous.error.code) ||
    failures.length - 1 >= input.maxFailedOperationRetries
  ) {
    return false;
  }
  return canFitOperationCost(input.budgetState, input.operation.estimatedCost);
}
