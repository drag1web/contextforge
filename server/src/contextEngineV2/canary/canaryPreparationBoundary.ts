import type { ContextEngineShadowCanonicalInput } from "../shadow/index.js";
import type { PrepareContextEngineShadowInput, ShadowStructuredTarget } from "../shadow/index.js";
import type { TaskPackCanaryPreparationFailureBasis } from "./canaryTypes.js";

export const TASK_PACK_CANARY_PREPARATION_LIMITS = Object.freeze({
  maxInventoryFiles: 5_000,
  maxTaskCharacters: 20_000,
  maxClarifications: 100,
  maxStructuredTargets: 100,
  maxProtectedScopes: 100,
  maxMetadataItemsPerFile: 200,
  maxMetadataCharacters: 5_000_000,
});

export type TaskPackCanaryPreparationErrorCode =
  | "preparation_limit_exceeded"
  | "execution_timeout";

export class TaskPackCanaryPreparationError extends Error {
  constructor(readonly code: TaskPackCanaryPreparationErrorCode) {
    super(code);
    this.name = "TaskPackCanaryPreparationError";
  }
}

export function createTaskPackCanaryPreparationFailureBasis(input: {
  totalFiles: number;
  reasonCode: TaskPackCanaryPreparationFailureBasis["reasonCode"];
}): TaskPackCanaryPreparationFailureBasis {
  if (!Number.isSafeInteger(input.totalFiles) || input.totalFiles < 0) {
    throw new TaskPackCanaryPreparationError("preparation_limit_exceeded");
  }
  return Object.freeze({
    schemaVersion: 1,
    totalFiles: input.totalFiles,
    configuredFileLimit: TASK_PACK_CANARY_PREPARATION_LIMITS.maxInventoryFiles,
    truncated: input.totalFiles > TASK_PACK_CANARY_PREPARATION_LIMITS.maxInventoryFiles,
    reasonCode: input.reasonCode,
  });
}

function denseWithin(value: unknown, maximum: number): value is readonly unknown[] {
  return Array.isArray(value) && value.length <= maximum && Object.keys(value).length === value.length;
}

function boundedText(value: unknown, maximum: number): boolean {
  return typeof value === "string" && value.length <= maximum;
}

export function assertTaskPackCanaryPreparationLimits(input: {
  inventory: PrepareContextEngineShadowInput["inventory"];
  normalizedTask: string;
  clarificationBasis: readonly { questionId: string; answer: string }[];
  structuredTargets: readonly ShadowStructuredTarget[];
  protectedScopes: readonly string[];
}): void {
  const limits = TASK_PACK_CANARY_PREPARATION_LIMITS;
  if (!boundedText(input.normalizedTask, limits.maxTaskCharacters) ||
      !denseWithin(input.inventory.files, limits.maxInventoryFiles) ||
      !denseWithin(input.clarificationBasis, limits.maxClarifications) ||
      !denseWithin(input.structuredTargets, limits.maxStructuredTargets) ||
      !denseWithin(input.protectedScopes, limits.maxProtectedScopes)) {
    throw new TaskPackCanaryPreparationError("preparation_limit_exceeded");
  }
  let metadataCharacters = input.normalizedTask.length;
  for (const clarification of input.clarificationBasis) {
    if (!boundedText(clarification.questionId, 300) || !boundedText(clarification.answer, 4_000)) {
      throw new TaskPackCanaryPreparationError("preparation_limit_exceeded");
    }
    metadataCharacters += clarification.questionId.length + clarification.answer.length;
  }
  for (const target of input.structuredTargets) {
    for (const value of [target.kind, target.value, target.path, target.name, target.provenance]) {
      if (value !== undefined && !boundedText(value, 1_000)) {
        throw new TaskPackCanaryPreparationError("preparation_limit_exceeded");
      }
      metadataCharacters += value?.length ?? 0;
    }
  }
  for (const scope of input.protectedScopes) {
    if (!boundedText(scope, 1_000)) throw new TaskPackCanaryPreparationError("preparation_limit_exceeded");
    metadataCharacters += scope.length;
  }
  for (const file of input.inventory.files) {
    const lists = [file.imports, file.exports, file.symbols, file.textHints];
    if (lists.some((list) => !denseWithin(list, limits.maxMetadataItemsPerFile)) ||
        !boundedText(file.path, 1_000) || !boundedText(file.name, 500) ||
        !boundedText(file.contentPreview ?? "", 20_000)) {
      throw new TaskPackCanaryPreparationError("preparation_limit_exceeded");
    }
    metadataCharacters += file.path.length + file.name.length + (file.contentPreview?.length ?? 0);
    for (const list of lists) {
      for (const value of list) {
        if (!boundedText(value, 1_000)) throw new TaskPackCanaryPreparationError("preparation_limit_exceeded");
        metadataCharacters += value.length;
      }
    }
    if (metadataCharacters > limits.maxMetadataCharacters) {
      throw new TaskPackCanaryPreparationError("preparation_limit_exceeded");
    }
  }
}

export function prepareBoundedTaskPackCanaryInput(input: {
  preparationInput: PrepareContextEngineShadowInput;
  deadlineMonotonicMs: number;
  monotonicMs(): number;
  prepare(value: PrepareContextEngineShadowInput): ContextEngineShadowCanonicalInput;
}): ContextEngineShadowCanonicalInput {
  assertTaskPackCanaryPreparationLimits({
    inventory: input.preparationInput.inventory,
    normalizedTask: input.preparationInput.normalizedTask,
    clarificationBasis: input.preparationInput.clarificationBasis ?? [],
    structuredTargets: input.preparationInput.structuredTargets,
    protectedScopes: input.preparationInput.protectedScopes,
  });
  if (input.monotonicMs() >= input.deadlineMonotonicMs) {
    throw new TaskPackCanaryPreparationError("execution_timeout");
  }
  const canonical = input.prepare(input.preparationInput);
  if (input.monotonicMs() >= input.deadlineMonotonicMs) {
    throw new TaskPackCanaryPreparationError("execution_timeout");
  }
  return canonical;
}
