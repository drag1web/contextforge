import type {
  TaskPackJsonObject,
  TaskPackJsonValue,
  TaskPackRevisionContent,
} from "./taskPackLifecycle.js";

export type GeneratedRevisionContentInput = Omit<
  TaskPackRevisionContent,
  | "sourceKind"
  | "generationRecipe"
  | "diagnostics"
  | "groundedContextSnapshot"
  | "freshnessBasis"
>;

export interface PrepareGeneratedTaskPackMaterialInput {
  readonly revisionContent: GeneratedRevisionContentInput;
  readonly generationRecipe: unknown;
  readonly selectorDiagnostics: unknown | null;
  readonly generationDiagnostics: unknown | null;
  readonly performanceDiagnostics: unknown | null;
}

export interface PreparedGeneratedTaskPackMaterial {
  readonly revisionContent: TaskPackRevisionContent;
  readonly compatibilityGenerationRecipe: TaskPackJsonObject;
}

export class TaskPackGeneratedCreateInputError extends Error {
  readonly code = "TASK_PACK_GENERATED_CREATE_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "TaskPackGeneratedCreateInputError";
  }
}

const RECIPE_DIAGNOSTIC_FIELDS = [
  "selectorDiagnostics",
  "generationDiagnostics",
  "performanceDiagnostics",
  "githubCreatedIssue",
] as const;

export function prepareGeneratedTaskPackMaterial(
  input: PrepareGeneratedTaskPackMaterialInput,
): PreparedGeneratedTaskPackMaterial {
  const generationRecipe = normalizeJsonObject(
    input.generationRecipe,
    "Task Pack generation recipe",
  );
  for (const field of RECIPE_DIAGNOSTIC_FIELDS) {
    if (Object.hasOwn(generationRecipe, field)) {
      throw new TaskPackGeneratedCreateInputError(
        `Task Pack generation recipe cannot contain ${field}.`,
      );
    }
  }

  const selector = normalizeNullableJsonObject(
    input.selectorDiagnostics,
    "Task Pack selector diagnostics",
  );
  const generation = normalizeNullableJsonObject(
    input.generationDiagnostics,
    "Task Pack generation diagnostics",
  );
  const performance = normalizeNullableJsonObject(
    input.performanceDiagnostics,
    "Task Pack performance diagnostics",
  );

  return {
    revisionContent: {
      sourceKind: "generated",
      rawTask: input.revisionContent.rawTask,
      taskType: input.revisionContent.taskType,
      targetTool: input.revisionContent.targetTool,
      generatedPrompt: input.revisionContent.generatedPrompt,
      generationMode: input.revisionContent.generationMode,
      generationModel: input.revisionContent.generationModel,
      generationMessage: input.revisionContent.generationMessage,
      generationUsedFallback: input.revisionContent.generationUsedFallback,
      generationDurationMs: input.revisionContent.generationDurationMs,
      generationRecipe,
      diagnostics: { selector, generation, performance },
      groundedContextSnapshot: null,
      freshnessBasis: null,
    },
    compatibilityGenerationRecipe: {
      ...generationRecipe,
      selectorDiagnostics: selector,
      generationDiagnostics: generation,
      performanceDiagnostics: performance,
    },
  };
}

function normalizeJsonObject(value: unknown, label: string): TaskPackJsonObject {
  const normalized = normalizeJsonValue(value, label, new WeakSet<object>());
  if (
    normalized === undefined ||
    normalized === null ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    throw new TaskPackGeneratedCreateInputError(
      `${label} must be a JSON-safe object.`,
    );
  }
  return normalized as TaskPackJsonObject;
}

function normalizeNullableJsonObject(
  value: unknown | null,
  label: string,
): TaskPackJsonObject | null {
  return value === null ? null : normalizeJsonObject(value, label);
}

function normalizeJsonValue(
  value: unknown,
  label: string,
  seen: WeakSet<object>,
): TaskPackJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TaskPackGeneratedCreateInputError(
        `${label} cannot contain non-finite numbers.`,
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TaskPackGeneratedCreateInputError(
      `${label} must contain only JSON-safe values.`,
    );
  }
  if (seen.has(value)) {
    throw new TaskPackGeneratedCreateInputError(`${label} cannot be cyclic.`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const normalized = normalizeJsonValue(item, label, seen);
        if (normalized === undefined) {
          throw new TaskPackGeneratedCreateInputError(
            `${label} arrays cannot contain undefined values.`,
          );
        }
        return normalized;
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TaskPackGeneratedCreateInputError(
        `${label} must contain only plain JSON objects.`,
      );
    }
    const normalized: Record<string, TaskPackJsonValue> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new TaskPackGeneratedCreateInputError(
          `${label} cannot contain symbol keys.`,
        );
      }
      const item = normalizeJsonValue(
        (value as Record<string, unknown>)[key],
        label,
        seen,
      );
      if (item !== undefined) normalized[key] = item;
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}
