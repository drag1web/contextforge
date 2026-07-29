import { containsSecretLikeSemanticValue } from "./semanticLiteralSafety.js";
import { assertDescriptorSafeDomainValue } from "./rawRecordPreflight.js";

export type InvestigationDomainErrorCode =
  | "invalid_record"
  | "record_conflict"
  | "snapshot_mismatch"
  | "unknown_reference"
  | "invalid_transition"
  | "invalid_budget"
  | "numeric_overflow";

export class InvestigationDomainError extends Error {
  readonly stage = "CE2-03" as const;

  constructor(
    readonly code: InvestigationDomainErrorCode,
    message: string,
    readonly recordId?: string,
  ) {
    super(message);
    this.name = "InvestigationDomainError";
  }
}

const PORTABLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CANONICAL_UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => stableCompare(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(`<${typeof value}>`);
}

export function cloneDomainValue<T>(value: T): T {
  try {
    assertDescriptorSafeDomainValue(value);
    return structuredClone(value);
  } catch (error) {
    if (error instanceof InvestigationDomainError) throw error;
    throw new InvestigationDomainError(
      "invalid_record",
      "Investigation domain record failed safe runtime validation.",
    );
  }
}

export function safeRecordId(value: unknown): string | undefined {
  return typeof value === "string" &&
    PORTABLE_IDENTIFIER.test(value) &&
    !containsSecretLikeSemanticValue(value)
    ? value
    : undefined;
}

export function assertPortableIdentifier(
  value: unknown,
  field: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !PORTABLE_IDENTIFIER.test(value) ||
    containsSecretLikeSemanticValue(value)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${field} must be a safe portable identifier.`,
    );
  }
}

export function assertSafeText(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    containsSecretLikeSemanticValue(value)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${field} must be a non-empty privacy-safe string.`,
    );
  }
}

export function assertCanonicalUtcTimestamp(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || !CANONICAL_UTC_TIMESTAMP.test(value)) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${field} must be a canonical UTC ISO timestamp.`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${field} must be a canonical UTC ISO timestamp.`,
    );
  }
}

export function assertClosedRecord(
  value: unknown,
  allowedFields: readonly string[],
  requiredFields: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  try {
    assertDescriptorSafeDomainValue(value);
  } catch {
    throw new InvestigationDomainError(
      "invalid_record",
      `${label} failed descriptor-safe validation.`,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${label} must be a structured record.`,
    );
  }
  const keys = Object.keys(value);
  const allowed = new Set(allowedFields);
  if (keys.some((key) => !allowed.has(key))) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${label} contains unsupported fields.`,
    );
  }
  for (const required of requiredFields) {
    if (!Object.hasOwn(value, required)) {
      throw new InvestigationDomainError(
        "invalid_record",
        `${label} is missing a required field.`,
      );
    }
  }
}

export function assertSortedUniqueStrings(
  value: unknown,
  field: string,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${field} must be a dense array of non-empty strings.`,
    );
  }
  const sorted = [...value].sort(stableCompare);
  if (
    new Set(value).size !== value.length ||
    value.some((entry, index) => entry !== sorted[index])
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${field} must be unique and deterministically sorted.`,
    );
  }
}

export function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(stableCompare);
}

export function sameDomainRecord(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

export function indexDomainRecordsById<T extends { id: string }>(
  records: readonly T[],
  label: string,
): Map<T["id"], T> {
  const safeRecords = cloneDomainValue(records);
  const indexed = new Map<T["id"], T>();
  for (const record of safeRecords) {
    assertPortableIdentifier(record.id, `${label} id`);
    const existing = indexed.get(record.id);
    if (existing && !sameDomainRecord(existing, record)) {
      throw new InvestigationDomainError(
        "record_conflict",
        `${label} id has conflicting context records.`,
        safeRecordId(record.id),
      );
    }
    if (!existing) indexed.set(record.id, record);
  }
  return new Map(
    [...indexed.entries()].sort(([left], [right]) =>
      stableCompare(left, right),
    ),
  );
}

export function assertSafeInteger(
  value: unknown,
  field: string,
  options: { positive?: boolean } = {},
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (options.positive ? value <= 0 : value < 0)
  ) {
    throw new InvestigationDomainError(
      "invalid_budget",
      `${field} must be a ${options.positive ? "positive" : "non-negative"} safe integer.`,
    );
  }
}
