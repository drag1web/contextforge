import { boundaryHash, PrimaryBoundaryError } from "./primaryBoundaryData.js";

/** Canonical LF bytes of the audited Git source; no other source drift allowed. */
export const AUDITED_PRIMARY_POLICY_SHA256 = "sha256:56eac2206b2af326debdde168b3441ae6d46d749045ca9eaa59767bb227b391b";
/** Exact CRLF checkout variant; ONLY these two raw-byte identities are accepted. */
export const AUDITED_PRIMARY_POLICY_CRLF_SHA256 = "sha256:19b7918564e5bf0df34e3edd805c247987bd68c388800911619435e36089ef3f";
declare const policyBrand: unique symbol;
export interface PrimaryPolicyEvidence {
  readonly sourceDigest: typeof AUDITED_PRIMARY_POLICY_SHA256;
  readonly rawSourceDigest: typeof AUDITED_PRIMARY_POLICY_SHA256 | typeof AUDITED_PRIMARY_POLICY_CRLF_SHA256;
  readonly newlineFormat: "lf" | "crlf";
  readonly plannerMode: "deterministic";
  readonly [policyBrand]: true;
}
export interface PrimaryBudgetIdentity {
  readonly budget: Readonly<Record<string, number>>;
  readonly timeoutMs: number;
  readonly maxHistoryRecords: number;
}
const policies = new WeakMap<object, Readonly<PrimaryBudgetIdentity>>();

/** Parse as DATA; never import or evaluate production policy/modules. */
export function inspectPrimaryPolicySource(raw: unknown): PrimaryPolicyEvidence {
  if (typeof raw !== "string" || raw.length > 4096) throw new PrimaryBoundaryError("policy_unverified");
  const rawSourceDigest = boundaryHash(raw);
  if (rawSourceDigest !== AUDITED_PRIMARY_POLICY_SHA256 && rawSourceDigest !== AUDITED_PRIMARY_POLICY_CRLF_SHA256) throw new PrimaryBoundaryError("policy_unverified");
  // Normalize CRLF to LF only AFTER exact raw-byte verification. Mixed/bare CR,
  // comments, whitespace edits, extra statements and numeric changes fail closed.
  const canonical = raw.replaceAll("\r\n", "\n");
  if (boundaryHash(canonical) !== AUDITED_PRIMARY_POLICY_SHA256) throw new PrimaryBoundaryError("policy_unverified");
  // Only the exact audited source can reach this deliberately narrow DATA grammar.
  // No compiler, dynamic import, eval, or caller-supplied budget values are used.
  const fields = /Object\.freeze\(\{\s*budget:\s*Object\.freeze\(\{([^{}]*)\}\),\s*timeoutMs:\s*([\d_]+),\s*maxHistoryRecords:\s*([\d_]+),\s*\}\);\s*$/u.exec(canonical);
  if (!fields) throw new PrimaryBoundaryError("policy_unverified");
  function number(literal: string): number {
    const value = Number(literal.replaceAll("_", ""));
    if (!Number.isSafeInteger(value) || value <= 0) throw new PrimaryBoundaryError("policy_unverified");
    return value;
  }
  const budget: Record<string, number> = {};
  for (const field of fields[1].split(",").map((item) => item.trim()).filter(Boolean)) {
    const pair = /^([A-Za-z][A-Za-z0-9]*):\s*([\d_]+)$/u.exec(field);
    if (!pair || Object.hasOwn(budget, pair[1])) throw new PrimaryBoundaryError("policy_unverified");
    budget[pair[1]] = number(pair[2]);
  }
  const identity = Object.freeze({ budget: Object.freeze(budget), timeoutMs: number(fields[2]), maxHistoryRecords: number(fields[3]) });
  const evidence = Object.freeze({ sourceDigest: AUDITED_PRIMARY_POLICY_SHA256, rawSourceDigest,
    newlineFormat: rawSourceDigest === AUDITED_PRIMARY_POLICY_SHA256 ? "lf" : "crlf", plannerMode: "deterministic" }) as PrimaryPolicyEvidence;
  policies.set(evidence, identity);
  return evidence;
}

export function verifiedPrimaryBudgetIdentity(evidence: unknown): Readonly<PrimaryBudgetIdentity> {
  const policy = policies.get(evidence as object);
  if (!policy) throw new PrimaryBoundaryError("policy_unverified");
  return policy;
}
