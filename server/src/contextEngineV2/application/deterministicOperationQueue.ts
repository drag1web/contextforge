import type { InvestigationOperation } from "../contracts/index.js";
import {
  cloneDomainValue,
  stableCompare,
} from "../domain/investigationDomainSupport.js";
import {
  mergeCompatibleOperationPurposes,
  operationTargetKey,
} from "./operationIdentity.js";

const TYPE_ORDER: Readonly<Record<InvestigationOperation["type"], number>> = {
  search_paths: 0,
  search_text: 1,
  search_symbols: 2,
  read_file: 3,
  read_range: 4,
  parse_file: 5,
  inspect_manifest: 6,
  follow_relationship: 7,
  inspect_git_context: 8,
  evaluate_absence: 9,
};

export function compareQueuedOperations(
  left: InvestigationOperation,
  right: InvestigationOperation,
): number {
  return (
    right.priority - left.priority ||
    TYPE_ORDER[left.type] - TYPE_ORDER[right.type] ||
    stableCompare(operationTargetKey(left), operationTargetKey(right)) ||
    stableCompare(left.id, right.id)
  );
}

export interface DeterministicOperationQueue {
  enqueue(operations: readonly InvestigationOperation[]): InvestigationOperation["id"][];
  dequeue(): InvestigationOperation | null;
  snapshot(): InvestigationOperation[];
}

export function createDeterministicOperationQueue(): DeterministicOperationQueue {
  const queued = new Map<string, InvestigationOperation>();
  return {
    enqueue(operations) {
      const duplicateIds: InvestigationOperation["id"][] = [];
      for (const raw of operations) {
        const operation = cloneDomainValue(raw);
        const existing = queued.get(operation.deduplicationKey);
        if (existing) duplicateIds.push(operation.id);
        queued.set(
          operation.deduplicationKey,
          existing
            ? mergeCompatibleOperationPurposes(existing, operation)
            : operation,
        );
      }
      return duplicateIds.sort(stableCompare);
    },
    dequeue() {
      const next = [...queued.values()].sort(compareQueuedOperations)[0];
      if (!next) return null;
      queued.delete(next.deduplicationKey);
      return cloneDomainValue(next);
    },
    snapshot() {
      return [...queued.values()].sort(compareQueuedOperations).map(cloneDomainValue);
    },
  };
}
