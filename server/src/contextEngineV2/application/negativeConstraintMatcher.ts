import type { NegativeConstraint } from "../contracts/index.js";

function normalizePathValue(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
}

function wildcardPatternMatches(path: string, pattern: string): boolean {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`, "u").test(path);
}

export function pathMatchesNegativeConstraints(
  path: string,
  constraints: readonly NegativeConstraint[],
): boolean {
  const normalizedPath = normalizePathValue(path);
  return constraints.some((constraint) => {
    if (constraint.kind !== "path") return false;
    const pattern = normalizePathValue(constraint.pattern);
    if (pattern.length === 0) return false;
    if (pattern.includes("*")) {
      return wildcardPatternMatches(normalizedPath, pattern);
    }
    return normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`);
  });
}
