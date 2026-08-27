import type { ContextEnginePlannerMode } from "../contracts/index.js";
export type { ContextEnginePlannerMode } from "../contracts/index.js";

export const DETERMINISTIC_PLANNER_IDENTIFIER =
  "deterministic-investigation-planner-v1";
export const MODEL_ASSISTED_PLANNER_IDENTIFIER =
  "model-assisted-investigation-planner-v1";

export function normalizeContextEnginePlannerMode(
  value: unknown,
): ContextEnginePlannerMode {
  return value === "model_assisted" ? "model_assisted" : "deterministic";
}

export function plannerIdentifierForMode(
  mode: ContextEnginePlannerMode,
): string {
  return normalizeContextEnginePlannerMode(mode) === "model_assisted"
    ? MODEL_ASSISTED_PLANNER_IDENTIFIER
    : DETERMINISTIC_PLANNER_IDENTIFIER;
}

export function plannerModeForIdentifier(
  identifier: unknown,
): ContextEnginePlannerMode {
  return identifier === MODEL_ASSISTED_PLANNER_IDENTIFIER
    ? "model_assisted"
    : "deterministic";
}

export function isContextEnginePlannerIdentifier(value: unknown): value is string {
  return value === DETERMINISTIC_PLANNER_IDENTIFIER ||
    value === MODEL_ASSISTED_PLANNER_IDENTIFIER;
}
