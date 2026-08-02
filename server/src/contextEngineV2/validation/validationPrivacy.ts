import { containsSecretLikeSemanticValue } from "../domain/semanticLiteralSafety.js";

const PORTABLE_ERROR_CODE = /^[a-z][a-z0-9_.:-]{0,80}$/u;
const PATH_BOUNDARY = String.raw`(?:^|[\s"'([{])`;
const WINDOWS_DRIVE_PATH = new RegExp(`${PATH_BOUNDARY}[A-Za-z]:[\\\\/]`, "u");
const UNC_PATH = new RegExp(`${PATH_BOUNDARY}\\\\{2,4}[^\\\\/\\s"']+[\\\\/][^\\\\/\\s"']+`, "u");
const UNIX_ABSOLUTE_PATH = new RegExp(
  `${PATH_BOUNDARY}/(?!/)[A-Za-z0-9._~-]+(?:/[A-Za-z0-9._~-]+)*`,
  "u",
);
const FILE_URI = /file:\/\//iu;
const CONTROL_CHARACTER = /[\0-\x1f\x7f]/u;
export const VALIDATION_STAGE_TIMINGS = new Set([
  "snapshot", "interpretation", "search", "read_parse", "graph", "evaluation", "projection",
]);

export function containsAbsolutePathOrFileUri(value: string): boolean {
  return FILE_URI.test(value) || WINDOWS_DRIVE_PATH.test(value) ||
    UNC_PATH.test(value) || UNIX_ABSOLUTE_PATH.test(value);
}

export function normalizeValidationErrorCode(value: unknown): string {
  return typeof value === "string" &&
    PORTABLE_ERROR_CODE.test(value) &&
    !containsSecretLikeSemanticValue(value) &&
    !containsAbsolutePathOrFileUri(value)
    ? value
    : "unexpected_execution_failure";
}

export function validatePrivacySafeReviewReason(value: unknown): string {
  if (
    typeof value !== "string" || value.trim().length === 0 || value.length > 240 ||
    CONTROL_CHARACTER.test(value) || containsAbsolutePathOrFileUri(value) ||
    containsSecretLikeSemanticValue(value)
  ) {
    throw new Error("Golden update reason must be bounded privacy-safe text.");
  }
  return value.trim();
}

export function assertPrivacySafeReviewReason(value: unknown): asserts value is string {
  validatePrivacySafeReviewReason(value);
}

export function validateStageTimings(
  raw: unknown,
): Record<string, number> {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) ||
    (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) {
    throw new Error("Stage timings failed safe runtime validation.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).some((key) =>
    typeof key !== "string" || !VALIDATION_STAGE_TIMINGS.has(key))) {
    throw new Error("Stage timings contain an unsupported stage.");
  }
  const output: Record<string, number> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable ||
      typeof descriptor.value !== "number" || !Number.isFinite(descriptor.value) || descriptor.value < 0) {
      throw new Error("Stage timing values must be finite non-negative numbers.");
    }
    output[key] = descriptor.value;
  }
  return output;
}

export function validateOptionalDuration(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Validation duration must be a finite non-negative number.");
  }
  return value;
}
