import {
  boundaryRecord, boundaryList, boundaryDigest, boundaryHash, boundaryPath,
  PrimaryBoundaryError,
} from "./primaryBoundaryData.js";
import { verifiedPrimaryBudgetIdentity } from "./primaryBoundaryPolicy.js";
import type { PrimaryBudgetIdentity, PrimaryPolicyEvidence } from "./primaryBoundaryPolicy.js";

export const PRIMARY_BOUNDARY_PROFILE = "rw02b1-primary-boundary" as const;
declare const sourceBrand: unique symbol;
declare const authorizationBrand: unique symbol;
declare const capabilitiesBrand: unique symbol;
export interface SyntheticPrimarySource {
  readonly kind: "synthetic_in_memory";
  readonly sourceDigest: string;
  readonly [sourceBrand]: true;
}
export interface SyntheticPrimaryAuthorization { readonly scope: "synthetic_boundary_only"; readonly [authorizationBrand]: true }
export interface RestrictedPrimaryCapabilities { readonly scope: "in_memory_source_only"; readonly [capabilitiesBrand]: true }
interface SourceFile { path: string; content: string; bytes: number; digest: string }
const sources = new WeakMap<object, readonly Readonly<SourceFile>[]>();
const authorizations = new WeakMap<object, SyntheticPrimarySource>();
const capabilities = new WeakMap<object, SyntheticPrimarySource>();

// Mechanical fixture bounds, not production CE2 budgets or source-scanner policy.
export const MAX_SYNTHETIC_PRIMARY_FILES = 16;
export const MAX_SYNTHETIC_PRIMARY_BYTES = 64 * 1024;

export function createSyntheticPrimarySource(raw: unknown): SyntheticPrimarySource {
  const input = boundaryRecord(raw, ["kind", "files"]);
  if (input.kind !== "synthetic_in_memory") throw new PrimaryBoundaryError("invalid_input");
  let bytes = 0;
  const files = boundaryList(input.files, MAX_SYNTHETIC_PRIMARY_FILES).map((value): Readonly<SourceFile> => {
    const file = boundaryRecord(value, ["path", "content"]);
    const path = boundaryPath(file.path);
    if (typeof file.content !== "string" || file.content.length > MAX_SYNTHETIC_PRIMARY_BYTES) throw new PrimaryBoundaryError("invalid_input");
    const encoded = Buffer.from(file.content, "utf8");
    if (encoded.toString("utf8") !== file.content) throw new PrimaryBoundaryError("invalid_input");
    bytes += encoded.byteLength;
    if (bytes > MAX_SYNTHETIC_PRIMARY_BYTES) throw new PrimaryBoundaryError("invalid_input");
    return Object.freeze({ path, content: file.content, bytes: encoded.byteLength, digest: boundaryHash(file.content) });
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (new Set(files.map((file) => file.path.toLowerCase())).size !== files.length) throw new PrimaryBoundaryError("invalid_input");
  const sourceDigest = boundaryHash(JSON.stringify(files.map(({ path, bytes: size, digest }) => ({ path, bytes: size, digest }))));
  const source = Object.freeze({ kind: "synthetic_in_memory", sourceDigest }) as SyntheticPrimarySource;
  sources.set(source, Object.freeze(files));
  return source;
}

export function authorizeSyntheticPrimarySource(raw: unknown): SyntheticPrimaryAuthorization {
  const input = boundaryRecord(raw, ["source", "sourceDigest", "scope", "approved", "evidenceDigest"]);
  const source = input.source as SyntheticPrimarySource;
  if (!sources.has(source)) throw new PrimaryBoundaryError("source_mismatch");
  if (boundaryDigest(input.sourceDigest) !== source.sourceDigest) throw new PrimaryBoundaryError("source_mismatch");
  if (input.scope !== "synthetic_boundary_only" || input.approved !== true) throw new PrimaryBoundaryError("authorization_missing");
  boundaryDigest(input.evidenceDigest); // Evidence reference, NOT proof of human approval of a real project.
  const authorization = Object.freeze({ scope: "synthetic_boundary_only" }) as SyntheticPrimaryAuthorization;
  authorizations.set(authorization, source);
  return authorization;
}

export function createRestrictedPrimaryCapabilities(raw: unknown): RestrictedPrimaryCapabilities {
  const input = boundaryRecord(raw, ["source", "authorization"]);
  const source = input.source as SyntheticPrimarySource;
  if (!sources.has(source)) throw new PrimaryBoundaryError("source_mismatch");
  if (authorizations.get(input.authorization as object) !== source) throw new PrimaryBoundaryError("authorization_missing");
  // No injectable callbacks or storage/network/FS/process capabilities exist.
  const capability = Object.freeze({ scope: "in_memory_source_only" }) as RestrictedPrimaryCapabilities;
  capabilities.set(capability, source);
  return capability;
}

function assertRestrictedPrimaryAdmission(source: unknown, digest: unknown, authorization: unknown, capability: unknown): asserts source is SyntheticPrimarySource {
  if (!sources.has(source as object)) throw new PrimaryBoundaryError("source_mismatch");
  if (boundaryDigest(digest) !== (source as SyntheticPrimarySource).sourceDigest) throw new PrimaryBoundaryError("source_mismatch");
  if (authorization === null || authorization === undefined) throw new PrimaryBoundaryError("authorization_missing");
  if (authorizations.get(authorization as object) !== source) throw new PrimaryBoundaryError("authorization_missing");
  if (capability === null || capability === undefined) throw new PrimaryBoundaryError("dependency_unresolved");
  if (capabilities.get(capability as object) !== source) throw new PrimaryBoundaryError("capability_rejected");
}

/** Private read primitive: no exported path around permit admission. */
function readRestrictedSyntheticFile(source: unknown, authorization: unknown, capability: unknown, path: unknown): Readonly<SourceFile> | null {
  const digest = sources.has(source as object) ? (source as SyntheticPrimarySource).sourceDigest : null;
  assertRestrictedPrimaryAdmission(source, digest, authorization, capability);
  const safePath = boundaryPath(path);
  return sources.get(source)!.find((file) => file.path === safePath) ?? null;
}

declare const sourceReadBrand: unique symbol;
declare const primaryExecutionBrand: unique symbol;
export interface SyntheticSourceReadPermit {
  readonly profileId: typeof PRIMARY_BOUNDARY_PROFILE;
  readonly scope: "synthetic_source_read_only";
  readonly sourceDigest: string;
  readonly [sourceReadBrand]: true;
}
/** Reserved contract. B1 CANNOT mint this: real production adapters are unconnected. */
export interface ReadOnlyPrimaryExecutionPermit {
  readonly scope: "production_primary_execution";
  readonly [primaryExecutionBrand]: true;
}
export interface PrimaryBoundaryRequest {
  profileId: typeof PRIMARY_BOUNDARY_PROFILE;
  source: SyntheticPrimarySource;
  sourceDigest: string;
  authorization: SyntheticPrimaryAuthorization | null;
  capabilities: RestrictedPrimaryCapabilities | null;
  policy: PrimaryPolicyEvidence | null;
  plannerMode: "deterministic";
}
type RejectionCode = PrimaryBoundaryError["code"] | "production_adapter_not_connected";
interface Rejection {
  readonly status: "blocked";
  readonly technicalStatus: "not_run" | "invalid_input";
  readonly code: RejectionCode;
  readonly engineInvoked: false;
  readonly semanticVerdict: null;
  readonly permit: null;
}
interface Admission {
  source: SyntheticPrimarySource;
  authorization: SyntheticPrimaryAuthorization;
  capability: RestrictedPrimaryCapabilities;
  policy: Readonly<PrimaryBudgetIdentity>;
}

export interface SyntheticSourceReadBasis {
  readonly sourceDigest: string;
  readonly files: readonly Readonly<{ path: string; bytes: number; digest: string }>[];
}
// Authenticate the issuer itself before a port can call its methods. This is
// source-read authority only; no execution state or caller callback is stored.
const sourceReadIssuers = new WeakMap<object, (permit: unknown) => SyntheticSourceReadBasis>();

export function describeSyntheticSourceReadBasis(boundary: unknown, permit: unknown): SyntheticSourceReadBasis {
  const describe = sourceReadIssuers.get(boundary as object);
  if (!describe) throw new PrimaryBoundaryError("capability_rejected");
  return describe(permit);
}

function check(raw: unknown): Admission {
  const input = boundaryRecord(raw, ["profileId", "source", "sourceDigest", "authorization", "capabilities", "policy", "plannerMode"]);
  if (input.profileId !== PRIMARY_BOUNDARY_PROFILE || input.plannerMode !== "deterministic") throw new PrimaryBoundaryError("invalid_input");
  assertRestrictedPrimaryAdmission(input.source, input.sourceDigest, input.authorization, input.capabilities);
  if (input.policy === null) throw new PrimaryBoundaryError("dependency_unresolved");
  return Object.freeze({
    source: input.source, authorization: input.authorization as SyntheticPrimaryAuthorization,
    capability: input.capabilities as RestrictedPrimaryCapabilities, policy: verifiedPrimaryBudgetIdentity(input.policy),
  });
}

function rejection(error: unknown): Rejection {
  const code = error instanceof PrimaryBoundaryError ? error.code : "invalid_input";
  return Object.freeze({ status: "blocked", technicalStatus: code === "invalid_input" || code === "unsupported_path" ? "invalid_input" : "not_run",
    code, engineInvoked: false, semanticVerdict: null, permit: null });
}

/** Constructor exposes no production callback/import, and performs no execution. */
export function createPrimaryReadOnlyBoundary() {
  // Source-read authority belongs only to this issuer, never another instance.
  const permits = new WeakMap<object, Readonly<Admission>>();
  const boundary = Object.freeze({
    requestSourceReadPermit(raw: unknown): Rejection | Readonly<{
      status: "source_read_permitted";
      technicalStatus: "not_run";
      engineInvoked: false;
      semanticVerdict: null;
      permit: SyntheticSourceReadPermit;
      productionPolicy: Readonly<PrimaryBudgetIdentity>;
    }> {
      try {
        const admission = check(raw);
        const permit = Object.freeze({ profileId: PRIMARY_BOUNDARY_PROFILE, scope: "synthetic_source_read_only", sourceDigest: admission.source.sourceDigest }) as SyntheticSourceReadPermit;
        permits.set(permit, admission);
        return Object.freeze({ status: "source_read_permitted", technicalStatus: "not_run", engineInvoked: false,
          semanticVerdict: null, permit, productionPolicy: admission.policy });
      } catch (error) { return rejection(error); }
    },
    requestPrimaryExecutionPermit(raw: unknown): Rejection {
      try { check(raw); }
      catch (error) { return rejection(error); }
      // No metadata/capability packet can connect write-capable production imports.
      return Object.freeze({ status: "blocked", technicalStatus: "not_run", code: "production_adapter_not_connected",
        engineInvoked: false, semanticVerdict: null, permit: null });
    },
    readSource(permit: unknown, path: unknown) {
      const admission = permits.get(permit as object);
      if (!admission) throw new PrimaryBoundaryError("capability_rejected");
      return readRestrictedSyntheticFile(admission.source, admission.authorization, admission.capability, path);
    },
  });
  sourceReadIssuers.set(boundary, (permit) => {
    const admission = permits.get(permit as object);
    if (!admission) throw new PrimaryBoundaryError("capability_rejected");
    assertRestrictedPrimaryAdmission(admission.source, admission.source.sourceDigest, admission.authorization, admission.capability);
    return Object.freeze({ sourceDigest: admission.source.sourceDigest,
      files: Object.freeze(sources.get(admission.source)!.map(({ path, bytes, digest }) => Object.freeze({ path, bytes, digest }))),
    });
  });
  return boundary;
}
