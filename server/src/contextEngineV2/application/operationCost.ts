import type {
  InvestigationOperation,
  OperationCost,
  RepositorySnapshot,
} from "../contracts/index.js";
import { cloneDomainValue } from "../domain/investigationDomainSupport.js";
import { InvestigationRunnerError } from "./investigationRunnerTypes.js";

export const ZERO_OPERATION_COST: OperationCost = {
  operations: 0,
  fileReads: 0,
  fileBytes: 0,
  parsedFiles: 0,
  relationshipHops: 0,
  plannerRounds: 0,
  wallTimeMs: 0,
};

function fileSize(snapshot: RepositorySnapshot, path: string): number {
  const file = snapshot.files.find((candidate) => candidate.normalizedPath === path);
  if (!file) {
    throw new InvestigationRunnerError(
      "invalid_input",
      "Operation target is absent from the active repository snapshot.",
    );
  }
  return file.sizeBytes;
}

export function estimateCanonicalOperationCost(input: {
  operation: InvestigationOperation;
  snapshot: RepositorySnapshot;
  hasVerifiedReadCache?: boolean;
}): OperationCost {
  const cost = { ...ZERO_OPERATION_COST, operations: 1 };
  switch (input.operation.type) {
    case "search_paths":
    case "search_text":
    case "search_symbols":
    case "inspect_git_context":
    case "evaluate_absence":
      return cost;
    case "read_file":
    case "read_range":
      return {
        ...cost,
        fileReads: 1,
        fileBytes: fileSize(input.snapshot, input.operation.path),
      };
    case "parse_file":
    case "inspect_manifest": {
      const requiresRead = input.hasVerifiedReadCache !== true;
      return {
        ...cost,
        fileReads: requiresRead ? 1 : 0,
        fileBytes: requiresRead
          ? fileSize(input.snapshot, input.operation.path)
          : 0,
        parsedFiles: 1,
      };
    }
    case "follow_relationship":
      return {
        ...cost,
        relationshipHops: input.operation.maxHops,
      };
  }
}

export function withCanonicalOperationCost(input: {
  operation: InvestigationOperation;
  snapshot: RepositorySnapshot;
  hasVerifiedReadCache?: boolean;
}): InvestigationOperation {
  return {
    ...cloneDomainValue(input.operation),
    estimatedCost: estimateCanonicalOperationCost(input),
  } as InvestigationOperation;
}

export function operationEstimateUnderstatesCanonicalCost(
  operation: InvestigationOperation,
  canonical: OperationCost,
): boolean {
  return (Object.keys(canonical) as Array<keyof OperationCost>).some(
    (field) => operation.estimatedCost[field] < canonical[field],
  );
}
