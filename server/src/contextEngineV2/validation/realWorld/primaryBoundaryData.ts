import { createHash } from "node:crypto";

export class PrimaryBoundaryError extends Error {
  constructor(readonly code: "invalid_input" | "unsupported_path" | "source_mismatch" | "authorization_missing" | "dependency_unresolved" | "capability_rejected" | "policy_unverified") {
    super(code);
    this.name = "PrimaryBoundaryError";
  }
}

/** Trusted data objects, not a sandbox for hostile JS Proxies/built-in patching. */
export function boundaryRecord(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) ||
      (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) throw new PrimaryBoundaryError("invalid_input");
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(fields).length !== keys.length || Reflect.ownKeys(fields).some((key) => typeof key !== "string" || !keys.includes(key))) throw new PrimaryBoundaryError("invalid_input");
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (!fields[key] || !("value" in fields[key]) || !fields[key].enumerable) throw new PrimaryBoundaryError("invalid_input");
    output[key] = fields[key].value;
  }
  return output;
}

export function boundaryList(raw: unknown, maximum: number): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype) throw new PrimaryBoundaryError("invalid_input");
  const length = Object.getOwnPropertyDescriptor(raw, "length")?.value as number;
  if (!Number.isSafeInteger(length) || length < 1 || length > maximum) throw new PrimaryBoundaryError("invalid_input");
  const fields = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(fields).length !== length + 1) throw new PrimaryBoundaryError("invalid_input");
  return Array.from({ length }, (_, index) => {
    const field = fields[String(index)];
    if (!field || !("value" in field) || !field.enumerable) throw new PrimaryBoundaryError("invalid_input");
    return field.value;
  });
}

export function boundaryDigest(raw: unknown): string {
  if (typeof raw !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(raw)) throw new PrimaryBoundaryError("invalid_input");
  return raw;
}

export function boundaryHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function boundaryPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 160 ||
      !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:ts|tsx|js|jsx|json)$/u.test(raw) ||
      /(?:^|\/)(?:node_modules|dist|build|coverage|uploads|logs|secrets|credentials)(?:\/|$)/iu.test(raw)) throw new PrimaryBoundaryError("unsupported_path");
  return raw;
}
