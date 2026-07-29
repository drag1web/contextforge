const SECRET_LIKE_PATTERNS = [
  /\b(?:api|api[_-]?key|token|access[_-]?token|auth[_-]?token|password|passwd|secret|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"',;}{]{6,}/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/u,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/u,
  /\bsk_(?:live|test)_[A-Za-z0-9]{12,}\b/u,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
];

const SENSITIVE_STRUCTURED_KEYS = new Set([
  "apikey",
  "token",
  "accesstoken",
  "authtoken",
  "authorization",
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "registrytoken",
]);

function normalizedStructuredKey(value: string): string {
  return value.replaceAll("_", "").replaceAll("-", "").toLowerCase();
}

function hasNonEmptyStructuredValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  if (typeof value !== "object") return false;
  try {
    return Reflect.ownKeys(value).some((key) => key !== "length");
  } catch {
    return false;
  }
}

export function isSecretLikeSemanticLiteral(value: string): boolean {
  return SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(value));
}

export function containsSecretLikeSemanticValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") return isSecretLikeSemanticLiteral(value);
  if (value === null || typeof value !== "object") return false;
  try {
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const propertyName =
        typeof key === "string" ? key : (key.description ?? "");
      if (isSecretLikeSemanticLiteral(propertyName)) {
        ancestors.delete(value);
        return true;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) continue;
      if (
        SENSITIVE_STRUCTURED_KEYS.has(normalizedStructuredKey(propertyName)) &&
        hasNonEmptyStructuredValue(descriptor.value)
      ) {
        ancestors.delete(value);
        return true;
      }
      if (
        containsSecretLikeSemanticValue(descriptor.value, ancestors)
      ) {
        ancestors.delete(value);
        return true;
      }
    }
    ancestors.delete(value);
    return false;
  } catch {
    ancestors.delete(value);
    return false;
  }
}
