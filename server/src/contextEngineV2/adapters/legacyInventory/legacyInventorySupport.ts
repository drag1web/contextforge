import { createHash } from "node:crypto";

export const LEGACY_INVENTORY_ADAPTER_VERSION =
  "legacy-inventory-snapshot-v1";
export const LEGACY_INVENTORY_HASH_ALGORITHM = "sha256";
export const LEGACY_INVENTORY_MAX_DEPTH = 7;
export const LEGACY_INVENTORY_COVERAGE_LIMITATIONS = [
  "deep_path_omissions_unobservable",
  "nested_directory_read_failures_unobservable",
  "truncated_false_means_no_known_scanner_omissions_only",
] as const;

export interface LegacyInventorySnapshotIssue {
  path: string;
  code: string;
  message: string;
}

export class LegacyInventorySnapshotError extends Error {
  readonly code = "invalid_legacy_inventory" as const;
  readonly stage = "CE2-01" as const;

  constructor(readonly issues: readonly LegacyInventorySnapshotIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "LegacyInventorySnapshotError";
  }
}

export function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function hashLegacyInventoryValue(value: string): string {
  return createHash(LEGACY_INVENTORY_HASH_ALGORITHM)
    .update(value)
    .digest("hex");
}

export function isDenseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      return false;
    }
  }
  return true;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isSafeRepositoryUri(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^repository:\/\/[A-Za-z0-9._~%-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*$/.test(
      value,
    )
  );
}

export function sortedStrings(
  value: unknown,
  issuePath: string,
  issues: LegacyInventorySnapshotIssue[],
): string[] {
  if (!isDenseArray(value)) {
    issues.push({
      path: issuePath,
      code: "invalid_type",
      message: "Expected a dense string array.",
    });
    return [];
  }
  const strings: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      issues.push({
        path: `${issuePath}[${index}]`,
        code: "invalid_type",
        message: "Expected a string.",
      });
    } else {
      strings.push(item);
    }
  });
  return strings.sort(stableCompare);
}

export function normalizeExcludedPatterns(
  patterns: readonly string[] | undefined,
  issues: LegacyInventorySnapshotIssue[],
): string[] {
  if (patterns === undefined) {
    return [];
  }
  if (!isDenseArray(patterns)) {
    issues.push({
      path: "excludedPatterns",
      code: "invalid_type",
      message: "Excluded patterns must be a dense string array.",
    });
    return [];
  }
  const normalized: string[] = [];
  patterns.forEach((pattern, index) => {
    if (!isNonEmptyString(pattern) || /\p{Cc}/u.test(pattern)) {
      issues.push({
        path: `excludedPatterns[${index}]`,
        code: "invalid_value",
        message: "Excluded pattern must be a non-empty safe string.",
      });
    } else {
      normalized.push(pattern.replaceAll("\\", "/"));
    }
  });
  return [...new Set(normalized)].sort(stableCompare);
}
