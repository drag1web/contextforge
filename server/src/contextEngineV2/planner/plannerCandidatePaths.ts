import type {
  FileDescriptor,
  InvestigationOperation,
} from "../contracts/index.js";
import type {
  DeterministicInvestigationPlan,
  DeterministicPlannerState,
} from "../application/index.js";
import { pathMatchesNegativeConstraints } from "../application/negativeConstraintMatcher.js";

function operationPaths(
  operation: InvestigationOperation,
  entityPaths: ReadonlyMap<string, string>,
): string[] {
  switch (operation.type) {
    case "read_file":
    case "read_range":
    case "parse_file":
    case "inspect_manifest":
      return [operation.path];
    case "inspect_git_context":
      return [...operation.paths];
    case "follow_relationship": {
      const path = entityPaths.get(operation.fromEntityId);
      return path ? [path] : [];
    }
    case "search_paths":
      return [operation.query];
    case "search_symbols":
    case "search_text":
    case "evaluate_absence":
      return [];
  }
}

function safeCandidate(
  file: FileDescriptor | undefined,
  state: Readonly<DeterministicPlannerState>,
): file is FileDescriptor {
  return Boolean(
    file &&
      file.readable &&
      !file.generated &&
      file.secretRisk === "none" &&
      !pathMatchesNegativeConstraints(file.normalizedPath, state.negativeConstraints),
  );
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Derives the model-visible path view from already-grounded deterministic
 * signals. Repository size never becomes the model context size.
 */
export function deriveGroundedModelCandidatePaths(input: {
  state: Readonly<DeterministicPlannerState>;
  deterministicPlan?: DeterministicInvestigationPlan;
  maximum: number;
}): string[] {
  const { state } = input;
  const filesByPath = new Map(
    state.snapshot.files.map((file) => [file.normalizedPath, file] as const),
  );
  const filesById = new Map(
    state.snapshot.files.map((file) => [file.id as string, file] as const),
  );
  const entityPaths = new Map<string, string>();

  for (const entity of state.entities) {
    const file = entity.fileId ? filesById.get(entity.fileId as string) : undefined;
    if (safeCandidate(file, state)) entityPaths.set(entity.id as string, file.normalizedPath);
  }

  const tiers: string[][] = [
    state.explicitTargets.flatMap((target) =>
      target.kind === "path" ? [target.path] : [],
    ),
    [...entityPaths.values()],
    state.operationCandidates.flatMap((operation) =>
      operationPaths(operation, entityPaths),
    ),
    (input.deterministicPlan?.operations ?? []).flatMap((operation) =>
      operationPaths(operation, entityPaths),
    ),
  ];
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const tier of tiers) {
    for (const path of sortedUnique(tier)) {
      if (selected.length >= input.maximum) break;
      const file = filesByPath.get(path);
      if (!safeCandidate(file, state) || seen.has(file.normalizedPath)) continue;
      seen.add(file.normalizedPath);
      selected.push(file.normalizedPath);
    }
    if (selected.length >= input.maximum) break;
  }

  return selected.sort((left, right) => left.localeCompare(right));
}
